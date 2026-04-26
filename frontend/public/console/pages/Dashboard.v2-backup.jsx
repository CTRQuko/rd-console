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

const { useState: _dsS, useEffect: _dsE, useRef: _dsR, useMemo: _dsM } = React;

// Helper: tone from threshold
const toneFor = (pct) => pct >= 85 ? "danger" : pct >= 65 ? "warn" : "ok";
const colorFor = (tone) => ({ ok: "var(--green-500)", warn: "var(--amber-500)", danger: "var(--red-500)" })[tone];

function Donut({ value, tone, icon, label }) {
  const angle = `${value * 3.6}deg`;
  const accent = colorFor(tone);
  return (
    <div
      style={{
        width: 168, height: 168, borderRadius: "50%",
        background: `conic-gradient(${accent} ${angle}, var(--bg-subtle) 0)`,
        display: "grid", placeItems: "center",
        position: "relative"
      }}>
      
      <div style={{
        width: 132, height: 132, borderRadius: "50%",
        background: "var(--card)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 2
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 }}>
          <Icon name={icon} size={14} />
          <span>{label}</span>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(value)}<small style={{ fontSize: 16, color: "var(--fg-muted)", marginLeft: 2 }}>%</small>
        </div>
      </div>
    </div>);

}

function MeterCard({ icon, label, value, tone, readouts }) {
  const left = readouts.slice(0, 2);
  const right = readouts[2];
  return (
    <div className="cm-card" style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", padding: 20, minHeight: 168 }}>
      {/* readout secundario fijado arriba-derecha de la card */}
      {right &&
      <div style={{ position: "absolute", top: 14, right: 16, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, whiteSpace: "nowrap" }}>{right.cap}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{right.val}</div>
        </div>
      }
      {/* Donut centrado en la mitad izquierda */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Donut value={value} tone={tone} icon={icon} label={label} />
      </div>
      {/* Stats: mini-grid label|valor, alineada a la derecha */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", paddingRight: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 14, rowGap: 10, alignItems: "center" }}>
          {left.map((r) =>
          <React.Fragment key={r.cap}>
              <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, whiteSpace: "nowrap", textAlign: "right" }}>{r.cap}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--fg)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "left" }}>{r.val}</div>
            </React.Fragment>
          )}
        </div>
      </div>
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
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, alignItems: "end", height: 140 }}>
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
        <a href="#/settings/logs" className="cm-btn cm-btn--ghost" style={{ fontSize: 13 }}>
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

function DashboardPage() {
  const cpu = 62;
  const ram = 69;

  return (
    <div className="cm-page">
      <PageHeader
        title="Dashboard"
        subtitle="Resumen del relay RustDesk."
        actions={<>
          <button className="cm-btn"><Icon name="refresh" size={14} /> Actualizar</button>
        </>} />
      

      {/* Mosaic: meters + tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
        <MeterCard
          icon="cpu" label="CPU" value={cpu} tone={toneFor(cpu)}
          readouts={[
          { cap: "Carga · 1m", val: "1.92" },
          { cap: "Procesos", val: "247" },
          { cap: "Núcleos", val: "8 cores @ 3.4 GHz" }]
          } />
        
        <MeterCard
          icon="memory" label="Memoria" value={ram} tone={toneFor(ram)}
          readouts={[
          { cap: "Usada", val: "11.0 GB" },
          { cap: "Libre", val: "5.0 GB" },
          { cap: "Total", val: "16 GB" }]
          } />
        
        <StatTile icon="link" label="Sesiones activas" value="1,247" sub="↑ 12% vs ayer" />
        <StatTile icon="zap" label="Ancho de banda" value="312 Mb/s" sub="↑ 4% vs hora ant." />
        <StatTile icon="activity" label="Disponibilidad" value="99.98%" sub="30 d · SLA cumplido" tone="ok"
        spark={[100, 100, 99.97, 100, 99.95, 100, 100, 99.92, 100, 98.4, 99.1, 100, 100, 99.98, 100, 100, 97.2, 99.3, 100, 100, 99.99, 100, 100, 99.96, 100, 100, 99.94, 100, 100, 99.98]} />
      </div>

      {/* Charts */}
      <div style={{ marginBottom: 16 }}>
        <ConnectionsHistogram buckets={MOCK_CONNECTIONS} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <ThroughputChart inSeries={MOCK_IN} outSeries={MOCK_OUT} max={200} />
      </div>

      <RecentConnections rows={MOCK_RECENT} />
    </div>);

}

window.DashboardPage = DashboardPage;