// @ts-nocheck
// Mechanically ported from public/console/pages/Dashboard.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports. ts-nocheck because the
// legacy code wasn't typed; tightening up types is a follow-up.
//
// Why this file still rides on @ts-nocheck (DashboardEdit, AddressBook,
// Logs, JoinTokens and Users were typed in the same pass): Dashboard
// is the densest page in the app — five MetricCard donuts each with
// a bespoke popout, ConnectionsHistogram24h, ThroughputChart, an
// UptimeBar30d sparkline, the recent-connections drawer, and the
// DashboardEdit grid integration all share implicit-any binding
// elements. A clean removal surfaces ~100 type errors that need to
// be threaded through every helper at once. Better landed as a
// dedicated PR (extracting the leaf helpers — Donut, PopHead,
// PopFoot, CoreBars — into typed sub-files first, then MetricCard,
// then the chart components) than crammed in here.
import {
  useState, useEffect, useMemo, useCallback, useRef,
} from "react";
import * as React from "react";
import { Icon } from "../components/Icon";
import {
  Tag, Dot, Switch, Tabs, EmptyState, Skeleton, ErrorBanner,
  Drawer, Modal, ConfirmDialog, PageSizeSelect, PageHeader,
  ToastProvider, useToast, useHashRoute,
} from "../components/primitives";
import { useStatsWebSocket } from "../shell/useStatsWebSocket";
import { useDashboardLayout, DashboardGrid, EditModeBar, CatalogPanel, CATALOG } from "./DashboardEdit";

// ============================================================
// Pages — Dashboard
// Compact rebuild of DashboardPage v2 ported into the shell.
// (Full meter + connections + throughput cards.)
// ============================================================
//
// ─────────────────────────────────────────────────────────────
// 🔌 BACKEND CONTRACT — endpoints que esta página espera
// ─────────────────────────────────────────────────────────────
// Polling sugerido: 5 s para métricas vivas, 60 s para histórico.
//
// 1. GET /api/v1/system/metrics                     (live, 5 s)
//    → {
//        cpu:    { pct: 0..100, load1: float, load5: float, load15: float,
//                  cores: int, ghz: float, model: string },
//        memory: { pct: 0..100, used_bytes: int, free_bytes: int,
//                  total_bytes: int },
//        sessions_active: int,
//        bandwidth_bps:   int,            // suma in+out actual
//        bandwidth_delta_pct_vs_prev_hour: float
//      }
//    Linux: leer /proc/stat (cpu pct via delta), /proc/loadavg, /proc/meminfo,
//    /proc/cpuinfo (cores+model+freq). Cachear cores/model/ghz al boot.
//
// 2. GET /api/v1/system/connections-24h             (60 s)
//    → { buckets: int[24] }    // contador por hora UTC, [0]=00:00
//    SQL: SELECT date_trunc('hour', ts) AS h, COUNT(*) FROM connection_events
//         WHERE ts >= now() - interval '24h' GROUP BY h ORDER BY h;
//
// 3. GET /api/v1/system/throughput?window=60m       (5 s)
//    → { in:  int[60], out: int[60], max_bps: int, link_capacity_bps: int }
//    Sample rate 1 sample/min. `link_capacity_bps` viene de config — la
//    UI lo usa para escalar el donut de saturación honestamente; si no
//    se conoce, usar `max_bps` * 1.2.
//    Linux: /proc/net/dev delta sobre la NIC del relay. macOS: getifaddrs.
//
// 4. GET /api/v1/system/uptime?days=30              (60 s)
//    → { series: float[30] }   // % uptime por día (0..100)
//    Calcular via heartbeat probes o synthetic checks; si <99 marcar
//    como degraded en la sparkline.
//
// 5. GET /api/v1/connections/recent?limit=20        (10 s)
//    → { rows: [{ from, to, action, ts, ip }] }
//    action ∈ {connect, file_transfer, disconnect, chat}.
//    `ts` ISO-8601; el frontend formatea "hace N min".
//
// Auth: todos requieren cookie/Bearer admin. Errores 5xx → mostrar
// estado "—" en la card y un toast con retry exponencial.
// ─────────────────────────────────────────────────────────────


// ─── Auth-aware fetch + polling hook (Etapa 3.4) ─────────────────────────
// Reads the JWT stored by Login.jsx under localStorage("cm-auth") and
// attaches it to every backend call. A 401 response wipes the token and
// reloads the page so the AuthGate in shell.jsx bounces to /login.
function _dsAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    return raw ? (JSON.parse(raw)?.token || null) : null;
  } catch {
    return null;
  }
}

async function _dsApiGet(path) {
  const token = _dsAuthToken();
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const res = await fetch(path, { headers });
  if (res.status === 401) {
    try { localStorage.removeItem("cm-auth"); } catch {}
    window.location.hash = "/login";
    return null;
  }
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status}`);
  }
  return res.json();
}

// Per-resource polling hook. `intervalMs=0` disables polling (single fetch).
function _dsUsePolledFetch(path, intervalMs) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await _dsApiGet(path);
        if (!cancelled && d) { setData(d); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e);
      }
    };
    tick();
    if (intervalMs > 0) {
      const id = setInterval(tick, intervalMs);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => { cancelled = true; };
  }, [path, intervalMs]);
  return { data, err };
}

// Helper: bytes → "12.4 GB" / "770 MB" / "320 KB". Uses 1024-base on
// purpose to match what `free -h` and Windows show.
function _dsFmtBytes(b) {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = Math.max(0, Number(b));
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

// Helper: bps → "312 Mb/s" / "12 kb/s" (network convention: 1000-base,
// lowercase 'b' = bits, capital 'B' = bytes).
function _dsFmtBps(bps) {
  if (bps == null) return "—";
  const u = ["b/s", "kb/s", "Mb/s", "Gb/s"];
  let i = 0, n = Math.max(0, Number(bps));
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${Math.round(n)} ${u[i]}`;
}

// Helper: ISO-ish timestamp → "hace N min" / "hace N h". Very rough,
// good enough for the recent-connections table.
function _dsFmtRelative(ts) {
  if (!ts) return "—";
  const t = typeof ts === "string" ? new Date(ts).getTime() : Number(ts);
  if (!Number.isFinite(t)) return "—";
  const dt = Math.max(0, (Date.now() - t) / 1000);
  if (dt < 60) return "ahora";
  if (dt < 3600) return `hace ${Math.floor(dt / 60)} min`;
  if (dt < 86400) return `hace ${Math.floor(dt / 3600)} h`;
  return `hace ${Math.floor(dt / 86400)} d`;
}

// Helper: tone from threshold
const toneFor = (pct) => pct >= 85 ? "danger" : pct >= 65 ? "warn" : "ok";
const colorFor = (tone) => ({ ok: "var(--green-500)", warn: "var(--amber-500)", danger: "var(--red-500)" })[tone];

function Donut({ value, tone, icon, label }) {
  const angle = `${value * 3.6}deg`;
  const accent = colorFor(tone);
  return (
    <div
      style={{
        width: 132, height: 132, borderRadius: "50%",
        background: `conic-gradient(${accent} ${angle}, var(--bg-subtle) 0)`,
        display: "grid", placeItems: "center",
        position: "relative"
      }}>
      
      <div style={{
        width: 104, height: 104, borderRadius: "50%",
        background: "var(--card)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>
          <Icon name={icon} size={12} />
          <span>{label}</span>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(value)}<small style={{ fontSize: 13, color: "var(--fg-muted)", marginLeft: 2 }}>%</small>
        </div>
      </div>
    </div>);

}

// ─── MetricCard: donut grande + chip clickable + dropdown contextual ──
// Patrón unificado para CPU, Memoria, Sesiones, Red, SLA.
function MetricCard({ icon, label, value, valueLabel, tone, chipLabel, children }) {
  const [pinned, setPinned] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const open = pinned || hover;
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!pinned) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setPinned(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pinned]);

  return (
    <div
      className="cm-card"
      data-popout-open={open ? "true" : "false"}
      style={{ padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, position: "relative", zIndex: open ? 50 : "auto" }}
      ref={ref}>
      {/* Donut con label/valor dentro */}
      <div style={{
        width: 132, height: 132, borderRadius: "50%",
        background: `conic-gradient(${colorFor(tone)} ${value * 3.6}deg, var(--bg-subtle) 0)`,
        display: "grid", placeItems: "center", position: "relative"
      }}>
        <div style={{
          width: 104, height: 104, borderRadius: "50%",
          background: "var(--card)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>
            <Icon name={icon} size={12} />
            <span>{label}</span>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums", fontSize: valueLabel ? 18 : 26, color: tone === "ok" && valueLabel ? colorFor("ok") : "var(--fg)" }}>
            {valueLabel || <>{Math.round(value)}<small style={{ fontSize: 13, color: "var(--fg-muted)", marginLeft: 2 }}>%</small></>}
          </div>
        </div>
      </div>

      {/* Chip clickable */}
      <div
        style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}>
        <button
          onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "var(--bg-subtle)", border: "1px solid var(--border)",
            borderRadius: 999, padding: "6px 12px",
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)",
            cursor: "pointer", fontVariantNumeric: "tabular-nums",
            transition: "background .15s"
          }}>
          {chipLabel}
          <span style={{ display: "inline-block", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none", opacity: .55, fontSize: 10 }}>▾</span>
        </button>

        {/* Dropdown anclado al chip */}
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%",
          transform: open ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(-4px)",
          minWidth: 280,
          background: "var(--card)", color: "var(--fg)", border: "1px solid var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,.10)",
          padding: "12px 14px", borderRadius: 10,
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity .15s, transform .15s",
          zIndex: 5
        }}>
          {children}
        </div>
      </div>
    </div>);

}

// ─── Helpers para los dropdowns ─────────────────
function PopHead({ left, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, color: "var(--fg-muted)", borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }}>
      <span style={{ color: "var(--fg)" }}>{left}</span>
      <span>{right}</span>
    </div>);

}

function PopFoot({ rows }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r, i) =>
      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>{r.k}</span>
          <span>{r.v}</span>
        </div>
      )}
    </div>);

}

// Barras verticales (cores) — para el dropdown de CPU
function CoreBars({ cores }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cores.length}, 1fr)`, gap: 6, alignItems: "end", height: 56, margin: "10px 0" }}>
      {cores.map((c, i) =>
      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: "100%", height: 40, background: "var(--bg-subtle)", borderRadius: 3, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${c.pct}%`, background: colorFor(toneFor(c.pct)), borderRadius: 3, transition: "height .25s" }} />
          </div>
          <label style={{ fontSize: 10, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>{i}</label>
        </div>
      )}
    </div>);

}

// Barras horizontales (filas) — para Memoria, Sesiones, Red, SLA
function HBars({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0 4px" }}>
      {rows.map((r, i) =>
      <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr 64px", gap: 10, alignItems: "center", fontSize: 11 }}>
          <span style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--fg)" }}>{r.name}</span>
          <span style={{ height: 6, background: "var(--bg-subtle)", borderRadius: 999, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", borderRadius: 999, width: `${r.pct}%`, background: r.color || "var(--primary)", transition: "width .25s" }} />
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--fg-muted)", textAlign: "right" }}>{r.val}</span>
        </div>
      )}
    </div>);

}

// Mini gráfico segmentado por estado: verde estable, amarillo medio, rojo caído.
// `series` = array de números 0..100 (uptime % por bucket). Threshold: ≥99.9 ok, ≥99 warn, <99 danger.
function StatusSparkline({ series, height = 40 }) {
  const W = 100,H = height; // viewBox simple, escalamos por SVG
  const min = 97,max = 100;
  const xs = series.map((_, i) => i / (series.length - 1) * W);
  const ys = series.map((v) => H - (v - min) / (max - min) * H);
  const toneAt = (v) => v >= 99.9 ? "ok" : v >= 99 ? "warn" : "danger";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", marginTop: 10 }}>
      {/* baseline sutil */}
      <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--border)" strokeWidth="0.5" />
      {series.slice(1).map((v, i) => {
        const tone = toneAt(v);
        return (
          <line
            key={i}
            x1={xs[i]} y1={ys[i]} x2={xs[i + 1]} y2={ys[i + 1]}
            stroke={colorFor(tone)} strokeWidth="1.6" strokeLinecap="round" />);

      })}
      {/* puntos en eventos no-OK */}
      {series.map((v, i) => {
        const tone = toneAt(v);
        if (tone === "ok") return null;
        return <circle key={i} cx={xs[i]} cy={ys[i]} r="1.6" fill={colorFor(tone)} />;
      })}
    </svg>);

}

function StatTile({ icon, label, value, sub, tone, spark }) {
  return (
    <div className="cm-card" style={{ padding: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-muted)", marginBottom: 12 }}>
        <Icon name={icon} size={16} />
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: tone ? colorFor(tone) : "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 6 }}>{sub}</div>
      {spark && <div style={{ width: "100%" }}><StatusSparkline series={spark} /></div>}
    </div>);

}

// ─── Histogram (24h connections) ──────────────────────
function ConnectionsHistogram({ buckets }) {
  const max = Math.max(...buckets);
  const [hover, setHover] = React.useState(null); // {i, v}
  return (
    <div className="cm-card">
      <div className="cm-card__head">
        <div>
          <h3 className="cm-card__title">Conexiones hoy</h3>
          <p style={{ margin: "2px 0 0", color: "var(--fg-muted)", fontSize: 13 }}>Últimas 24 h · buckets de 1 h</p>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {buckets.reduce((a, b) => a + b, 0).toLocaleString()}
        </div>
      </div>
      <div data-chart-fill="true" style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, alignItems: "end", height: 140 }}>
        {buckets.map((v, i) => {
          const isHover = hover?.i === i;
          const isLast = i === buckets.length - 1;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover({ i, v })}
              onMouseLeave={() => setHover(null)}
              style={{
                position: "relative",
                height: `${v / max * 100}%`,
                minHeight: 4,
                background: isHover ?
                "var(--primary)" :
                isLast ? "var(--primary)" : "color-mix(in oklab, var(--primary) 35%, transparent)",
                borderRadius: 3,
                cursor: "pointer",
                transition: "background 120ms"
              }}>
              {isHover &&
              <div style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: "50%",
                transform: "translateX(-50%)",
                background: "var(--fg)",
                color: "var(--card)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "6px 8px",
                borderRadius: 6,
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,.15)",
                zIndex: 2,
                fontVariantNumeric: "tabular-nums"
              }}>
                  <div style={{ fontWeight: 700 }}>{v.toLocaleString()} conexiones</div>
                  <div style={{ opacity: 0.7, fontSize: 10 }}>{i.toString().padStart(2, "0")}:00–{((i + 1) % 24).toString().padStart(2, "0")}:00</div>
                </div>
              }
            </div>);

        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "var(--fg-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:59</span>
      </div>
    </div>);

}

// ─── Network throughput ────────────────────────────────
function ThroughputChart({ inSeries, outSeries, max }) {
  const w = 600,h = 160;
  const N = inSeries.length;
  const step = w / (N - 1);
  const path = (data) =>
  data.map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${h - v / max * h}`).join(" ");

  const wrapRef = React.useRef(null);
  const [hover, setHover] = React.useState(null); // {i, xPct (0-100)}

  const onMove = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const pct = x / r.width;
    const i = Math.max(0, Math.min(N - 1, Math.round(pct * (N - 1))));
    setHover({ i, xPct: i / (N - 1) * 100 });
  };
  const onLeave = () => setHover(null);

  const fmt = (v) => `${Math.round(v)} Mb/s`;
  const minutesAgo = (i) => N - 1 - i;
  const minLabel = (i) => i === N - 1 ? "ahora" : `hace ${minutesAgo(i)} min`;

  return (
    <div className="cm-card">
      <div className="cm-card__head">
        <div>
          <h3 className="cm-card__title">Tráfico de red</h3>
          <p style={{ margin: "2px 0 0", color: "var(--fg-muted)", fontSize: 13 }}>Últimos 60 minutos · entrada / salida</p>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--fg-muted)" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--primary)", borderRadius: 2, marginRight: 6 }} />In</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--violet-500)", borderRadius: 2, marginRight: 6 }} />Out</span>
        </div>
      </div>
      <div
        ref={wrapRef}
        data-chart-fill="true"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        style={{ position: "relative", cursor: "crosshair" }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 200, display: "block" }}>
          <defs>
            <linearGradient id="cm-throughput-in" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cm-throughput-out" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--violet-500)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--violet-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) =>
          <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="var(--border)" strokeDasharray="2 4" />
          )}
          <path d={`${path(inSeries)} L${w},${h} L0,${h} Z`} fill="url(#cm-throughput-in)" />
          <path d={path(inSeries)} fill="none" stroke="var(--primary)" strokeWidth="2" />
          <path d={`${path(outSeries)} L${w},${h} L0,${h} Z`} fill="url(#cm-throughput-out)" />
          <path d={path(outSeries)} fill="none" stroke="var(--violet-500)" strokeWidth="2" />
          {hover &&
          <g pointerEvents="none">
              <line x1={hover.i * step} x2={hover.i * step} y1="0" y2={h} stroke="var(--fg-muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <circle cx={hover.i * step} cy={h - inSeries[hover.i] / max * h} r="4" fill="var(--primary)" stroke="var(--card)" strokeWidth="2" />
              <circle cx={hover.i * step} cy={h - outSeries[hover.i] / max * h} r="4" fill="var(--violet-500)" stroke="var(--card)" strokeWidth="2" />
            </g>
          }
        </svg>
        {hover &&
        <>
            {/* OUT a la IZQUIERDA del crosshair */}
            <div style={{
            position: "absolute",
            left: `calc(${hover.xPct}% - 8px)`,
            top: 8,
            transform: "translateX(-100%)",
            background: "var(--violet-500)",
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 4px 12px rgba(0,0,0,.15)",
            pointerEvents: "none"
          }}>
              <span style={{ opacity: 0.75, marginRight: 6 }}>OUT</span>{fmt(outSeries[hover.i])}
            </div>
            {/* IN a la DERECHA del crosshair */}
            <div style={{
            position: "absolute",
            left: `calc(${hover.xPct}% + 8px)`,
            top: 8,
            background: "var(--primary)",
            color: "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 4px 12px rgba(0,0,0,.15)",
            pointerEvents: "none"
          }}>
              <span style={{ opacity: 0.85, marginRight: 6 }}>IN</span>{fmt(inSeries[hover.i])}
            </div>
            {/* Etiqueta de tiempo abajo */}
            <div style={{
            position: "absolute",
            left: `${hover.xPct}%`,
            transform: "translateX(-50%)",
            bottom: 4,
            background: "var(--fg)",
            color: "var(--card)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            pointerEvents: "none"
          }}>
              {minLabel(hover.i)}
            </div>
          </>
        }
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, color: "var(--fg-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
        <span>−60m</span><span>−45m</span><span>−30m</span><span>−15m</span><span>now</span>
      </div>
    </div>);

}

// ─── Mock data ─────────────────────────────────────────
const MOCK_CONNECTIONS = [12, 18, 8, 5, 3, 4, 11, 35, 78, 124, 152, 168, 174, 161, 148, 139, 128, 144, 102, 76, 54, 38, 27, 19];
const MOCK_IN = Array.from({ length: 60 }, (_, i) => 80 + 50 * Math.sin(i / 3) + 30 * Math.sin(i / 7) + Math.random() * 20);
const MOCK_OUT = Array.from({ length: 60 }, (_, i) => 60 + 35 * Math.sin(i / 4 + 1) + 25 * Math.sin(i / 9) + Math.random() * 15);

const MOCK_RECENT = [
{ from: "746 980 791", to: "941 662 646", action: "connect", time: "hace 2 min", ip: "157.168.74.78" },
{ from: "576 091 068", to: "534 015 562", action: "file_transfer", time: "hace 8 min", ip: "152.168.84.81" },
{ from: "157 187 027", to: "135 638 707", action: "file_transfer", time: "hace 12 min", ip: "143.108.67.175" },
{ from: "233 102 990", to: "880 215 016", action: "connect", time: "hace 24 min", ip: "81.45.12.190" },
{ from: "412 668 345", to: "771 332 559", action: "disconnect", time: "hace 31 min", ip: "190.27.18.4" },
{ from: "099 778 154", to: "662 901 834", action: "connect", time: "hace 47 min", ip: "83.51.220.6" },
{ from: "746 980 791", to: "412 668 345", action: "chat", time: "hace 1 h", ip: "157.168.74.78" },
{ from: "880 215 016", to: "233 102 990", action: "file_transfer", time: "hace 1 h", ip: "190.42.55.71" }];


const ACTION_TONE = { connect: "primary", file_transfer: "violet", disconnect: "default", chat: "green" };
const ACTION_LABEL = { connect: "connect", file_transfer: "file transfer", disconnect: "disconnect", chat: "chat" };

function RecentConnections({ rows }) {
  return (
    <div className="cm-card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="cm-card__head" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div>
          <h3 className="cm-card__title">Conexiones recientes</h3>
          <p style={{ margin: "2px 0 0", color: "var(--fg-muted)", fontSize: 13 }}>Últimos eventos del relay · vivo</p>
        </div>
        <a href="#/logs" className="cm-btn cm-btn--ghost" style={{ fontSize: 13 }}>
          Ver historial completo <Icon name="arrow-right" size={12} />
        </a>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        <table className="cm-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Action</th>
              <th>Time</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
            <tr key={i}>
                <td style={{ fontFamily: "var(--font-mono)" }}>{r.from}</td>
                <td style={{ fontFamily: "var(--font-mono)" }}>{r.to}</td>
                <td><Tag tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Tag></td>
                <td style={{ color: "var(--fg-muted)" }}>{r.time}</td>
                <td style={{ fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{r.ip}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>);

}

export function DashboardPage() {
  // Live polling per the BACKEND CONTRACT comment at the top of this file.
  // Cadences: 5 s metrics + throughput, 10 s recent, 60 s histogram + uptime.
  const { data: pollMetrics } = _dsUsePolledFetch("/api/v1/system/metrics", 5000);
  const { data: connections24h } = _dsUsePolledFetch("/api/v1/system/connections-24h", 60000);
  const { data: throughput } = _dsUsePolledFetch("/api/v1/system/throughput?window=60m", 5000);
  const { data: uptime } = _dsUsePolledFetch("/api/v1/system/uptime?days=30", 60000);
  const { data: recent } = _dsUsePolledFetch("/api/v1/connections/recent?limit=20", 10000);

  // WebSocket /api/v1/ws/stats pushes the same payload every 5 s with no
  // round-trip cost. When the socket is connected we prefer its data;
  // polling stays as a fallback for the first ~250 ms before the socket
  // warms up and for the case where the socket drops with auth codes
  // (4001/4003) and we don't reconnect.
  const wsMetrics = useStatsWebSocket();
  const metrics = wsMetrics || pollMetrics;

  // Derive each MetricCard's headline value from the live payload.
  // Falls back to 0 / dashes while the first poll is in flight so the
  // donuts render at "empty" rather than crashing on undefined access.
  const cpu = Math.round(metrics?.cpu?.pct ?? 0);
  const ram = Math.round(metrics?.memory?.pct ?? 0);
  const sessionsActive = metrics?.sessions_active ?? 0;
  const sessionsLimit = 5000; // TODO: pull from /config/server.session_limit when wired
  const sessionsPct = Math.min(100, Math.round((sessionsActive / sessionsLimit) * 100));
  const bandwidthBps = metrics?.bandwidth_bps ?? 0;
  const linkCapacity = throughput?.link_capacity_bps ?? 1_000_000_000;
  const networkPct = linkCapacity > 0
    ? Math.min(100, Math.round((bandwidthBps / linkCapacity) * 100))
    : 0;

  // SLA: average of the 30-day uptime series; degraded days = days <99%.
  const uptimeSeries = uptime?.series ?? [];
  const slaAvg = uptimeSeries.length > 0
    ? uptimeSeries.reduce((a, b) => a + b, 0) / uptimeSeries.length
    : 100;
  const slaIncidents = uptimeSeries.filter((v) => v < 99).length;

  // Imported at module top (see DashboardEdit import).
  const { layout, edit, startEdit, cancelEdit, saveEdit, resetToDefault, setDraft } = useDashboardLayout();

  const visibleIds = layout.map(w => w.id);

  const addWidget = (cat) => {
    setDraft(prev => {
      // Encontrar primera fila libre al final
      const maxY = Math.max(0, ...prev.map(w => w.y + w.h));
      return [...prev, { id: cat.id, x: 0, y: maxY, w: cat.defaultSize.w, h: cat.defaultSize.h }];
    });
  };

  return (
    <div className="cm-page">
      <PageHeader
        title="Dashboard"
        subtitle="Resumen del relay RustDesk."
        actions={<>
          {!edit && <button className="cm-btn" onClick={startEdit}><Icon name="edit" size={14} /> Editar dashboard</button>}
          <button className="cm-btn"><Icon name="refresh" size={14} /> Actualizar</button>
        </>} />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
      <EditModeBar edit={edit} layout={layout} onCancel={cancelEdit} onSave={saveEdit} onReset={resetToDefault} />
      <DashboardGrid layout={layout} edit={edit} onChange={setDraft}>

<div data-widget-id="cpu">
        <MetricCard
          icon="cpu" label="CPU" value={cpu} tone={toneFor(cpu)}
          chipLabel={metrics
            ? `${metrics.cpu.cores} cores${metrics.cpu.ghz ? " @ " + metrics.cpu.ghz + " GHz" : ""}`
            : "—"}>
          <PopHead left="Carga global" right={metrics?.cpu?.model || "—"} />
          {/* TODO: backend returns CPU pct as a single global number — for
              real per-core breakdown wire psutil.cpu_percent(percpu=True)
              into a /system/metrics/cpu-cores endpoint. Until then we
              render N=cores bars all at the global pct so the layout
              stays right. */}
          <CoreBars cores={Array.from(
            { length: metrics?.cpu?.cores ?? 0 },
            () => ({ pct: cpu })
          )} />
          <PopFoot rows={[
            { k: "Carga · 1m", v: metrics?.cpu?.load1?.toFixed(2) ?? "—" },
            { k: "Carga · 5m", v: metrics?.cpu?.load5?.toFixed(2) ?? "—" },
          ]} />
        </MetricCard>
        </div>

<div data-widget-id="memory">
        <MetricCard
          icon="memory" label="Memoria" value={ram} tone={toneFor(ram)}
          chipLabel={metrics
            ? `${_dsFmtBytes(metrics.memory.used_bytes)} / ${_dsFmtBytes(metrics.memory.total_bytes)}`
            : "—"}>
          <PopHead
            left="Uso de memoria"
            right={metrics
              ? `${_dsFmtBytes(metrics.memory.used_bytes)}/${_dsFmtBytes(metrics.memory.total_bytes)}`
              : "—"}
          />
          {/* TODO: per-process breakdown needs psutil.process_iter() on the
              server. Today the donut + chip carry the real data; this
              dropdown stays as a placeholder until the endpoint exists. */}
          <HBars rows={[
            { name: "Usada", pct: ram, val: _dsFmtBytes(metrics?.memory?.used_bytes ?? 0), color: "var(--primary)" },
            { name: "Libre", pct: 100 - ram, val: _dsFmtBytes(metrics?.memory?.free_bytes ?? 0), color: "var(--green-500)" },
          ]} />
          <PopFoot rows={[
            { k: "Total", v: _dsFmtBytes(metrics?.memory?.total_bytes ?? 0) },
            { k: "Libre", v: _dsFmtBytes(metrics?.memory?.free_bytes ?? 0) },
          ]} />
        </MetricCard>
        </div>

<div data-widget-id="sessions">
        <MetricCard
          icon="link" label="Sesiones" value={sessionsPct} tone={toneFor(sessionsPct)}
          valueLabel={
            sessionsActive >= 1000
              ? <>{(sessionsActive / 1000).toFixed(1)}<small style={{ fontSize: 13, color: "var(--fg-muted)", marginLeft: 2 }}>k</small></>
              : <>{sessionsActive}</>
          }
          chipLabel={`${sessionsActive.toLocaleString()} / ${sessionsLimit.toLocaleString()}`}>
          <PopHead left="Sesiones activas" right={`${sessionsPct}% cuota`} />
          {/* TODO: per-platform breakdown requires aggregating Device.platform
              over the active set. Single-row stub until that endpoint is
              wired (sessions vs. limit). */}
          <HBars rows={[
            { name: "Activas", pct: sessionsPct, val: sessionsActive.toLocaleString(), color: "var(--primary)" },
            { name: "Disponibles", pct: 100 - sessionsPct, val: (sessionsLimit - sessionsActive).toLocaleString(), color: "var(--green-500)" },
          ]} />
          <PopFoot rows={[
            { k: "Activas", v: sessionsActive.toLocaleString() },
            { k: "Cuota", v: sessionsLimit.toLocaleString() },
          ]} />
        </MetricCard>
        </div>

<div data-widget-id="network">
        <MetricCard
          icon="zap" label="Red" value={networkPct} tone={toneFor(networkPct)}
          valueLabel={(() => {
            const txt = _dsFmtBps(bandwidthBps);
            const [num, unit] = txt.split(" ");
            return <>{num}<small style={{ fontSize: 11, color: "var(--fg-muted)", marginLeft: 2 }}>{unit}</small></>;
          })()}
          chipLabel={`${networkPct}% del enlace`}>
          <PopHead
            left="Tráfico actual"
            right={`${networkPct}% de ${_dsFmtBps(linkCapacity)}`}
          />
          {/* TODO: per-interface in/out breakdown requires sampling
              psutil.net_io_counters(pernic=True) over time on the server.
              For now we show the global aggregate. */}
          <HBars rows={[
            { name: "Total", pct: networkPct, val: _dsFmtBps(bandwidthBps), color: "var(--primary)" },
            { name: "Capacidad", pct: 100 - networkPct, val: _dsFmtBps(Math.max(0, linkCapacity - bandwidthBps)), color: "var(--green-500)" },
          ]} />
          <PopFoot rows={[
            { k: "Capacidad", v: _dsFmtBps(linkCapacity) },
            { k: "Sesiones", v: sessionsActive.toLocaleString() },
          ]} />
        </MetricCard>
        </div>

<div data-widget-id="sla">
        <MetricCard
          icon="activity" label="SLA" value={Math.round(slaAvg)} tone="ok"
          valueLabel={`${slaAvg.toFixed(2)}%`}
          chipLabel={`${uptimeSeries.length} d · ${slaIncidents} incidente${slaIncidents === 1 ? "" : "s"}`}>
          <PopHead
            left="Uptime diario"
            right={`Últimos ${uptimeSeries.length} días`}
          />
          {/* TODO: backend /api/v1/system/uptime is currently a stub that
              returns 100% for every day until heartbeat probes get
              persisted. Once that lands, list real incidents here. */}
          <HBars rows={[
            { name: "Promedio", pct: Math.min(100, slaAvg), val: `${slaAvg.toFixed(2)}%`, color: "var(--green-500)" },
            { name: "Objetivo", pct: 99.9, val: "99.9%", color: "var(--primary)" },
          ]} />
          <PopFoot rows={[
            { k: "Días sin incidente", v: `${uptimeSeries.length - slaIncidents}` },
            { k: "Días degradados", v: `${slaIncidents}` },
          ]} />
        </MetricCard>
        </div>

<div data-widget-id="histogram">
          <ConnectionsHistogram
            buckets={connections24h?.buckets ?? Array(24).fill(0)}
          />
        </div>

        <div data-widget-id="throughput">
          {/* The backend's /system/throughput endpoint is a stub today —
              it returns the same value 60 times so the chart renders. The
              max prop is `max_bps` from the server, with a +1 floor to
              avoid division-by-zero in the first paint. */}
          <ThroughputChart
            inSeries={throughput?.in ?? Array(60).fill(0)}
            outSeries={throughput?.out ?? Array(60).fill(0)}
            max={Math.max(1, throughput?.max_bps ?? 1)}
          />
        </div>

        <div data-widget-id="recent">
          <RecentConnections
            rows={(recent?.rows ?? []).map((r) => ({
              from: r.from || "—",
              to: r.to || "—",
              action: r.action,
              time: _dsFmtRelative(r.ts),
              ip: r.ip || "—",
            }))}
          />
        </div>

      </DashboardGrid>
      </div>
        {edit && <CatalogPanel visibleIds={visibleIds} onAdd={addWidget} />}
      </div>
    </div>);

}

