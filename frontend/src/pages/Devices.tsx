// @ts-nocheck
// Mechanically ported from public/console/pages/Devices.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports. ts-nocheck because the
// legacy code wasn't typed; tightening up types is a follow-up.
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
import { Popover } from "../shell/Popover";

// ============================================================
// Pages — Devices
// Lista + drawer detalle (notas, OS override, tags incrementales)
// + menú ⋯ con editar / forzar reconexión / eliminar
// ============================================================


// ─── Auth-aware fetch helpers (Etapa 3.5) ─────────────────────────────────
function _dvAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    return raw ? (JSON.parse(raw)?.token || null) : null;
  } catch {
    return null;
  }
}
async function _dvApi(path, init = {}) {
  const token = _dvAuthToken();
  const headers = {
    ...(init.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    try { localStorage.removeItem("cm-auth"); } catch {}
    window.location.hash = "/login";
    throw new Error("unauthenticated");
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Format helpers ───────────────────────────────────────────────────────
function _dvFmtRelative(ts) {
  if (!ts) return "—";
  const t = typeof ts === "string" ? new Date(ts).getTime() : Number(ts);
  if (!Number.isFinite(t)) return "—";
  const dt = Math.max(0, (Date.now() - t) / 1000);
  if (dt < 60) return "ahora";
  if (dt < 3600) return `Hace ${Math.floor(dt / 60)}m`;
  if (dt < 86400) return `Hace ${Math.floor(dt / 3600)}h`;
  return `Hace ${Math.floor(dt / 86400)}d`;
}

// Map ApiDevice (backend shape) → the {id, alias, user, os, ver, ip,
// lastSeen, online, tags, notes} shape this page was originally built
// against. `usersById` is a precomputed map id→username so the table
// can show "alex@…" instead of "user #5".
function _dvAdaptDevice(api, usersById) {
  return {
    id: String(api.id),
    rustdeskId: api.rustdesk_id,
    alias: api.hostname || api.rustdesk_id || `device-${api.id}`,
    user: api.owner_user_id != null ? (usersById.get(api.owner_user_id) || `user #${api.owner_user_id}`) : "—",
    os: api.platform || "—",
    ver: api.version || "—",
    ip: api.last_ip || "—",
    lastSeen: _dvFmtRelative(api.last_seen_at),
    online: !!api.online,
    tags: (api.tags || []).map((t) => t.name),
    notes: api.note || "",
    favorite: !!api.is_favorite,
  };
}

// Map backend Tag (with .device_count) → the {name, color, count} shape
// the original mock catalog used.
function _dvAdaptTag(api) {
  return { id: api.id, name: api.name, color: api.color, count: api.device_count ?? 0 };
}

const TAG_PALETTE = ["violet", "amber", "green", "blue", "rose", "teal", "orange", "slate"];

const _DEVICES_INIT = [
  { id: "ddef-9821", alias: "alex-laptop",   user: "alex@casaredes.cc",   os: "macOS 14.5",      lastSeen: "Hace 2m",  online: true,  ip: "10.0.4.18",   ver: "1.3.2", tags: ["personal"], notes: "Portátil del operador admin. Tiene acceso completo al relay." },
  { id: "ddef-9822", alias: "design-mac-01", user: "diana@casaredes.cc",  os: "macOS 14.4",      lastSeen: "Hace 1m",  online: true,  ip: "10.0.4.32",   ver: "1.3.2", tags: ["design"], notes: "" },
  { id: "ddef-9823", alias: "build-srv-eu",  user: "ci@casaredes.cc",     os: "Ubuntu 22.04",    lastSeen: "Hace 30s", online: true,  ip: "10.0.20.7",   ver: "1.3.1", tags: ["servers", "ci"], notes: "Servidor de build CI/CD. **No reiniciar entre 02:00–06:00 UTC** (corre nightlies)." },
  { id: "ddef-9824", alias: "lab-pc-04",     user: "lab@casaredes.cc",    os: "Windows 11",      lastSeen: "Hace 1h",  online: false, ip: "10.0.7.4",    ver: "1.2.9", tags: ["lab"], notes: "" },
  { id: "ddef-9825", alias: "kiosk-front",   user: "kiosk@casaredes.cc",  os: "Windows 10 LTSC", lastSeen: "Hace 4h",  online: false, ip: "10.0.50.1",   ver: "1.2.8", tags: ["kiosk"], notes: "Kiosko de recepción. Usuario sin permisos de cierre de sesión." },
  { id: "ddef-9826", alias: "diana-mbp",     user: "diana@casaredes.cc",  os: "macOS 14.5",      lastSeen: "Hace 5m",  online: true,  ip: "10.0.4.40",   ver: "1.3.2", tags: ["design", "remote"], notes: "" },
  { id: "ddef-9827", alias: "qa-rig",        user: "qa@casaredes.cc",     os: "Windows 11",      lastSeen: "Hace 12m", online: true,  ip: "10.0.10.99",  ver: "1.3.0", tags: ["qa"], notes: "" },
  { id: "ddef-9828", alias: "old-router",    user: "ops@casaredes.cc",    os: "Linux (custom)",  lastSeen: "Hace 7d",  online: false, ip: "10.0.0.1",    ver: "1.1.3", tags: ["legacy"], notes: "Router viejo. Marcado para retirada Q1." },
];

// Catálogo de tags global (mock — backend devolverá esto via /tags)
const _TAGS_INIT = [
  { name: "personal", color: "violet", count: 1 },
  { name: "design",   color: "amber",  count: 2 },
  { name: "servers",  color: "blue",   count: 1 },
  { name: "ci",       color: "blue",   count: 1 },
  { name: "lab",      color: "green",  count: 1 },
  { name: "kiosk",    color: "rose",   count: 1 },
  { name: "remote",   color: "slate",  count: 1 },
  { name: "qa",       color: "green",  count: 1 },
  { name: "legacy",   color: "slate",  count: 1 },
];

const tagColor = (catalog, name) => (catalog.find((t) => t.name === name)?.color) || "slate";
const colorVar = (c) => `var(--${c}-500, var(--fg-muted))`;

// ─── Tag chip ─────────────────────────────────────────
function TagChip({ name, color, removable, onRemove }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", paddingRight: removable ? 4 : 8,
      borderRadius: 999, fontSize: 11, fontWeight: 500,
      background: `color-mix(in oklab, ${colorVar(color)} 15%, transparent)`,
      color: colorVar(color),
      border: `1px solid color-mix(in oklab, ${colorVar(color)} 30%, transparent)`,
    }}>
      {name}
      {removable && (
        <button
          onClick={onRemove}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "grid", placeItems: "center" }}
          aria-label={`Quitar ${name}`}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

// ─── Tag input incremental ────────────────────────────
function TagInput({ value, onChange, catalog, onCreateTag }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return catalog
      .filter((t) => !value.includes(t.name) && (!q || t.name.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [draft, catalog, value]);

  const exactMatch = catalog.some((t) => t.name === draft.trim().toLowerCase());
  const canCreate = draft.trim() && !exactMatch && !value.includes(draft.trim().toLowerCase());

  const add = (name) => {
    if (!value.includes(name)) onChange([...value, name]);
    setDraft("");
  };
  const create = () => {
    const name = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    onCreateTag(name);
    add(name);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
        padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8,
        background: "var(--card)", minHeight: 36,
      }}>
        {value.map((name) => (
          <TagChip key={name} name={name} color={tagColor(catalog, name)} removable onRemove={() => onChange(value.filter((v) => v !== name))} />
        ))}
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (suggestions[0]) add(suggestions[0].name); else if (canCreate) create(); }
            if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          placeholder={value.length ? "" : "Añadir tag…"}
          style={{
            flex: 1, minWidth: 100, border: "none", outline: "none",
            background: "transparent", fontSize: 13, color: "var(--fg)",
          }}
        />
      </div>
      {open && (suggestions.length > 0 || canCreate) && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          zIndex: 20, padding: 4, maxHeight: 240, overflowY: "auto",
        }}>
          {suggestions.map((t) => (
            <button
              key={t.name}
              onClick={() => add(t.name)}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", border: "none", background: "transparent",
                fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6,
                color: "var(--fg)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorVar(t.color) }} />
              <span style={{ flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{t.count} usos</span>
            </button>
          ))}
          {canCreate && (
            <button
              onClick={create}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "6px 8px", border: "none", background: "transparent",
                fontSize: 13, cursor: "pointer", textAlign: "left", borderRadius: 6,
                color: "var(--primary)", borderTop: suggestions.length ? "1px solid var(--border)" : "none",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Icon name="plus" size={12} /> Crear tag <strong>{draft.trim().toLowerCase()}</strong>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OS suggestions (combobox) ────────────────────────
const OS_CATALOG = [
  // macOS
  "macOS 15.0 Sequoia", "macOS 14.5 Sonoma", "macOS 14.4 Sonoma", "macOS 13.7 Ventura", "macOS 12.7 Monterey",
  // Windows
  "Windows 11 24H2", "Windows 11 23H2", "Windows 11", "Windows 10 22H2", "Windows 10 LTSC 2021", "Windows Server 2022", "Windows Server 2019",
  // Linux
  "Ubuntu 24.04 LTS", "Ubuntu 22.04 LTS", "Ubuntu 20.04 LTS", "Debian 12", "Debian 11",
  "Fedora 40", "Fedora 39", "Arch Linux", "Linux Mint 21", "openSUSE Tumbleweed",
  "RHEL 9", "RHEL 8", "Rocky Linux 9", "AlmaLinux 9",
  // BSD / otros
  "FreeBSD 14", "OpenBSD 7.5", "Linux (custom)",
  // Mobile
  "iOS 18", "iOS 17", "Android 14", "Android 13",
];

function OSCombobox({ value, onChange, autoFocus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const q = (value || "").trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!q) return OS_CATALOG.slice(0, 10);
    return OS_CATALOG.filter((s) => s.toLowerCase().includes(q)).slice(0, 10);
  }, [q]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        className="cm-input"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="p. ej. macOS, Ubuntu, Windows…"
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30,
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          padding: 4, maxHeight: 240, overflowY: "auto",
        }}>
          {suggestions.map((s) => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
              style={{
                display: "block", width: "100%", padding: "6px 8px",
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: 13, textAlign: "left", borderRadius: 6, color: "var(--fg)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Edit-in-place row (lápiz a la izq) ────────────────
function EditableRow({ label, value, onChange, mono, render }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  return (
    <>
      <dt style={{ color: "var(--fg-muted)", fontSize: 13, alignSelf: "center", display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => setEditing((v) => !v)}
          aria-label={`Editar ${label}`}
          title={`Editar ${label}`}
          style={{
            width: 22, height: 22, borderRadius: 5,
            border: "1px solid var(--border)", background: editing ? "var(--primary)" : "var(--bg-subtle)",
            color: editing ? "var(--primary-fg, #fff)" : "var(--fg-muted)",
            cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0,
          }}
        >
          <Icon name="edit" size={11} />
        </button>
        <span>{label}</span>
      </dt>
      <dd style={{ margin: 0 }}>
        {editing ? (
          render ? render({ ref: inputRef, value, onChange, onBlur: () => setEditing(false) }) : (
            <input
              ref={inputRef}
              className="cm-input"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setEditing(false)}
              style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
            />
          )
        ) : (
          <span style={mono ? { fontFamily: "var(--font-mono)" } : undefined}>
            {value || <em style={{ color: "var(--fg-muted)" }}>—</em>}
          </span>
        )}
      </dd>
    </>
  );
}

// ─── Read-only row ────────────────────────────────────
function ReadOnlyRow({ label, value, mono }) {
  return (
    <>
      <dt style={{ color: "var(--fg-muted)", fontSize: 13, alignSelf: "center", display: "flex", alignItems: "center", gap: 6, paddingLeft: 28 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, color: "var(--fg-muted)" }}>
        <span style={mono ? { fontFamily: "var(--font-mono)" } : undefined}>{value || "—"}</span>
      </dd>
    </>
  );
}

// ─── Drawer detalle ───────────────────────────────────
function DeviceDrawer({ device, catalog, onClose, onSave, onCreateTag, onRequestDelete }) {
  const [draft, setDraft] = useState(null);
  const [activityOpen, setActivityOpen] = useState(true);
  const [pendingClose, setPendingClose] = useState(false);
  const [activity, setActivity] = useState({ items: [], state: "idle" });

  useEffect(() => {
    if (device) {
      setDraft({ alias: device.alias, os: device.os, notes: device.notes || "", tags: [...device.tags] });
      setActivityOpen(true);
    }
  }, [device]);

  // Pull the audit-log slice for this device whenever it changes. The
  // backend filters by from_id/to_id/payload, so we get connect/disconnect,
  // file_transfer, panel-side device edits, and tag mutations in one feed.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    setActivity({ items: [], state: "loading" });
    _dvApi(`/admin/api/devices/${device.id}/activity?limit=10`)
      .then((rows) => {
        if (cancelled) return;
        setActivity({ items: rows || [], state: "ready" });
      })
      .catch(() => {
        if (cancelled) return;
        setActivity({ items: [], state: "error" });
      });
    return () => { cancelled = true; };
  }, [device]);

  if (!device || !draft) return null;

  const dirty =
    draft.alias !== device.alias ||
    draft.os !== device.os ||
    draft.notes !== (device.notes || "") ||
    draft.tags.join("|") !== device.tags.join("|");

  const tryClose = () => {
    if (dirty) setPendingClose(true);
    else onClose();
  };

  const save = () => { onSave(device.id, draft); };

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <>
      <Drawer
        open={!!device}
        onClose={tryClose}
        title={device.alias}
        footer={
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <button
              className="cm-btn"
              onClick={() => onRequestDelete(device)}
              style={{ color: "#e11d48", borderColor: "color-mix(in oklab, #e11d48 40%, var(--border))" }}
            >
              <Icon name="trash" size={14} /> Eliminar
            </button>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="cm-btn" onClick={tryClose}>Cerrar</button>
              <button className="cm-btn cm-btn--primary" onClick={save} disabled={!dirty}>
                <Icon name="check" size={14} /> Guardar
              </button>
            </div>
          </div>
        }
      >
        {/* Header con estado online */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Dot online={device.online} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>{device.alias}</div>
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>{device.user}</div>
          </div>
        </div>

        {/* Campos editables */}
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "12px 16px", margin: 0, alignItems: "start" }}>
          <EditableRow
            label="Alias"
            value={draft.alias}
            onChange={(v) => set({ alias: v })}
          />
          <EditableRow
            label="Sistema"
            value={draft.os}
            onChange={(v) => set({ os: v })}
            render={({ ref, value, onChange, onBlur }) => (
              <OSCombobox value={value} onChange={onChange} autoFocus />
            )}
          />
          <ReadOnlyRow label="Device ID" value={device.id} mono />
          <ReadOnlyRow label="Versión"   value={device.ver} mono />
          <ReadOnlyRow label="IP"        value={device.ip}  mono />
          <ReadOnlyRow label="Última conexión" value={device.lastSeen} />

          {/* Tags — editable directo */}
          <dt style={{ color: "var(--fg-muted)", fontSize: 13, alignSelf: "flex-start", paddingTop: 8, paddingLeft: 28 }}>Tags</dt>
          <dd style={{ margin: 0 }}>
            <TagInput
              value={draft.tags}
              onChange={(tags) => set({ tags })}
              catalog={catalog}
              onCreateTag={onCreateTag}
            />
          </dd>
        </dl>

        {/* Notas — editables directas */}
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600, marginTop: 24, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--fg-muted)" }}>Notas</h3>
        <textarea
          className="cm-textarea"
          rows={4}
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Notas internas. Soporta **negrita** y `código`."
        />

        {/* Actividad reciente — colapsable */}
        <button
          onClick={() => setActivityOpen((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            background: "transparent", border: "none", cursor: "pointer",
            padding: 0, marginTop: 24, marginBottom: 8,
            fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: ".06em", color: "var(--fg-muted)",
          }}
          aria-expanded={activityOpen}
        >
          <Icon name={activityOpen ? "chevron-down" : "chevron-right"} size={12} />
          Actividad reciente
        </button>
        {activityOpen && (
          <>
            {activity.state === "loading" && (
              <div style={{ color: "var(--fg-muted)", fontSize: 13, padding: "8px 0" }}>
                Cargando historial…
              </div>
            )}
            {activity.state === "error" && (
              <div style={{ color: "#e11d48", fontSize: 13, padding: "8px 0" }}>
                No se pudo cargar el historial.
              </div>
            )}
            {activity.state === "ready" && activity.items.length === 0 && (
              <div style={{ color: "var(--fg-muted)", fontSize: 13, padding: "8px 0" }}>
                Aún no hay actividad registrada.
              </div>
            )}
            {activity.state === "ready" && activity.items.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {activity.items.map((e) => {
                  // Combine label + description + actor into the human line so
                  // the operator can read a single sentence per event.
                  const detail = [e.label, e.description].filter(Boolean).join(" — ");
                  const trail = e.actor && !["connect", "disconnect", "close", "file_transfer"].includes(e.action)
                    ? ` · por ${e.actor}` : "";
                  return (
                    <li key={e.id} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                      <span style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 110 }}>{_dvFmtRelative(e.when)}</span>
                      <span>{detail}{trail}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Drawer>

      {/* Aviso cambios sin guardar */}
      <ConfirmDialog
        open={pendingClose}
        onClose={() => setPendingClose(false)}
        onConfirm={() => { setPendingClose(false); onClose(); }}
        title="¿Descartar cambios?"
        description="Tienes cambios sin guardar. Si cierras ahora se perderán."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        tone="danger"
      />
    </>
  );
}

// ─── Menú ⋯ ──────────────────────────────────────────
function _DvKebab({ items, onClick }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const menuH = Math.min(items.length * 36 + 16, 360);
      setOpenUp(window.innerHeight - r.bottom < menuH + 12);
    }
    setOpen((v) => !v);
  };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={toggle}>
        <Icon name="more" />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          ...(openUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
          right: 0, zIndex: 50,
          minWidth: 200, background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 4,
        }}>
          {items.map((it, i) => it === "sep" ? (
            <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          ) : (
            <button
              key={i}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
                color: it.danger ? "#e11d48" : "var(--fg)", fontSize: 13, textAlign: "left", cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.icon && <Icon name={it.icon} size={14} />} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Crear dispositivo (pre-checkin) ─────────────────
function CreateDeviceModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ rustdesk_id: "", hostname: "", platform: "" });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setForm({ rustdesk_id: "", hostname: "", platform: "" });
      setErrors({});
    }
  }, [open]);

  const validate = () => {
    const e = {};
    const rid = form.rustdesk_id.trim();
    if (!rid) e.rustdesk_id = "Requerido";
    else if (!/^[\d\s]+$/.test(rid) && !/^[\w-]+$/.test(rid)) {
      e.rustdesk_id = "Solo dígitos, espacios o guiones";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Añadir dispositivo"
      width={520}
      footer={
        <>
          <button
            className="cm-btn cm-btn--primary"
            onClick={() => validate() && onSubmit(form)}
          >
            <Icon name="check" size={14} /> Registrar
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </>
      }
    >
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        Pre-registra un dispositivo por su RustDesk ID. Aparecerá como
        offline hasta que el cliente envíe su primer heartbeat.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>RustDesk ID</label>
          <input
            className="cm-input"
            autoFocus
            value={form.rustdesk_id}
            onChange={(e) => setForm((f) => ({ ...f, rustdesk_id: e.target.value }))}
            placeholder="123 456 789"
          />
          {errors.rustdesk_id && (
            <div style={{ color: "#e11d48", fontSize: 12, marginTop: 4 }}>{errors.rustdesk_id}</div>
          )}
          <div style={{ color: "var(--fg-muted)", fontSize: 12, marginTop: 4 }}>
            El identificador que muestra el cliente RustDesk.
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Alias (opcional)</label>
          <input
            className="cm-input"
            value={form.hostname}
            onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value }))}
            placeholder="laptop-alex"
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Sistema (opcional)</label>
          <input
            className="cm-input"
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
            placeholder="Windows 11"
          />
        </div>
      </div>
    </Drawer>
  );
}

// ─── Filtros persistidos en el hash ───────────────────
// `?q=…&filter=online&os=macOS,Linux&tags=ci,prod` permite recargar o
// compartir un enlace conservando lo que estaba viendo el operador.
// `state=…` (override de debug que ya consumía el código) se preserva
// como sub-parámetro independiente.
//
// Asunción de codificación: `os` y `tags` se serializan como CSV
// (comma-separated). Ambos dominios están constreñidos a tokens sin
// comas — la lista `osFamily` es un enum cerrado {macOS, Windows,
// Linux, Android, iOS, Otros}, y los nombres de Tag se validan en
// `backend/app/routers/tags.py` con el regex `[A-Za-z0-9_\- .]+`.
// Si alguno de los dos dominios admite comas en el futuro, cambiar
// a `?os=a&os=b` (entries repetidas) en lugar de la concatenación.
function _dvReadFiltersFromHash() {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return { q: "", filter: "all", osFilter: [], tagFilter: [] };
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const f = params.get("filter") || "all";
  const allowed = new Set(["all", "online", "offline"]);
  return {
    q: params.get("q") || "",
    filter: allowed.has(f) ? f : "all",
    osFilter: (params.get("os") || "").split(",").filter(Boolean),
    tagFilter: (params.get("tags") || "").split(",").filter(Boolean),
  };
}

function _dvWriteFiltersToHash(filters) {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  const path = qIdx < 0 ? hash.slice(1) : hash.slice(1, qIdx);
  const existing = qIdx < 0 ? new URLSearchParams() : new URLSearchParams(hash.slice(qIdx + 1));
  // Preserve unrelated debug params (currently just `state`).
  const preserved = new URLSearchParams();
  for (const key of ["state"]) {
    const v = existing.get(key);
    if (v) preserved.set(key, v);
  }
  if (filters.q) preserved.set("q", filters.q);
  if (filters.filter !== "all") preserved.set("filter", filters.filter);
  if (filters.osFilter.length) preserved.set("os", filters.osFilter.join(","));
  if (filters.tagFilter.length) preserved.set("tags", filters.tagFilter.join(","));
  const qs = preserved.toString();
  const next = qs ? `#${path}?${qs}` : `#${path}`;
  if (next !== hash) {
    window.history.replaceState(null, "", next);
  }
}

// ─── Página ──────────────────────────────────────────
export function DevicesPage({ route }) {
  const _dvInitial = _dvReadFiltersFromHash();
  const [q, setQ] = useState(_dvInitial.q);
  const [filter, setFilter] = useState(_dvInitial.filter);
  const [selected, setSelected] = useState(null);
  const [state, setState] = useState("loading");
  const [devices, setDevices] = useState([]);
  const [tagCatalog, setTagCatalog] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [osFilter, setOsFilter] = useState(_dvInitial.osFilter);     // ["macOS","Windows","Linux"]
  const [tagFilter, setTagFilter] = useState(_dvInitial.tagFilter);  // tag names
  const filtersBtnRef = useRef(null);

  // Sync filter state → hash query string. `replaceState` avoids the
  // back-stack growing one entry per keystroke in the search box.
  useEffect(() => {
    _dvWriteFiltersToHash({ q, filter, osFilter, tagFilter });
  }, [q, filter, osFilter, tagFilter]);

  // ─── Initial data load (Etapa 3.5) ──────────────────────────────────
  // Pulls devices, tags, and users in parallel so the table can show
  // "alex@…" instead of the bare owner_user_id. Polled every 30 s so
  // online/offline transitions and last-seen update on screen.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [devicesRes, tagsRes, usersRes] = await Promise.all([
          _dvApi("/admin/api/devices"),
          _dvApi("/admin/api/tags"),
          _dvApi("/admin/api/users").catch(() => []),
        ]);
        if (cancelled) return;
        const usersById = new Map((usersRes || []).map((u) => [u.id, u.username]));
        setDevices((devicesRes || []).map((d) => _dvAdaptDevice(d, usersById)));
        setTagCatalog((tagsRes || []).map(_dvAdaptTag));
        setState("ready");
      } catch (err) {
        if (!cancelled) setState("error");
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const osFamily = (osStr) => {
    const s = (osStr || "").toLowerCase();
    if (s.includes("mac")) return "macOS";
    if (s.includes("win")) return "Windows";
    if (s.includes("linux") || s.includes("ubuntu") || s.includes("debian") || s.includes("fedora")) return "Linux";
    if (s.includes("android")) return "Android";
    if (s.includes("ios")) return "iOS";
    return "Otros";
  };
  const osOptions = useMemo(() => {
    const set = new Set(devices.map((d) => osFamily(d.os)));
    return [...set];
  }, [devices]);

  const toggleArr = (setter) => (val) => setter((arr) => arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  const clearAllFilters = () => { setOsFilter([]); setTagFilter([]); setFilter("all"); };
  const activeFilterCount = osFilter.length + tagFilter.length + (filter !== "all" ? 1 : 0);

  // URL `?state=loading|empty|error` is a design-debug override that
  // bypasses the live fetch (used for visual review of skeletons /
  // empty / error states). When the param is absent we let the load
  // useEffect own the state value.
  useEffect(() => {
    const m = route.match(/[?&]state=(\w+)/);
    if (m) setState(m[1]);
  }, [route]);

  const items = useMemo(() => {
    if (state !== "ready") return [];
    let arr = devices;
    if (filter === "online")  arr = arr.filter((d) => d.online);
    if (filter === "offline") arr = arr.filter((d) => !d.online);
    if (osFilter.length)  arr = arr.filter((d) => osFilter.includes(osFamily(d.os)));
    if (tagFilter.length) arr = arr.filter((d) => (d.tags || []).some((t) => tagFilter.includes(t)));
    if (q.trim()) {
      const ql = q.toLowerCase();
      arr = arr.filter((d) =>
        d.alias.toLowerCase().includes(ql) ||
        d.user.toLowerCase().includes(ql) ||
        d.id.toLowerCase().includes(ql) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(ql))
      );
    }
    return arr.slice(0, pageSize);
  }, [q, filter, state, devices, pageSize, osFilter, tagFilter]);

  const totalFiltered = useMemo(() => {
    if (state !== "ready") return 0;
    let arr = devices;
    if (filter === "online")  arr = arr.filter((d) => d.online);
    if (filter === "offline") arr = arr.filter((d) => !d.online);
    if (osFilter.length)  arr = arr.filter((d) => osFilter.includes(osFamily(d.os)));
    if (tagFilter.length) arr = arr.filter((d) => (d.tags || []).some((t) => tagFilter.includes(t)));
    if (q.trim()) {
      const ql = q.toLowerCase();
      arr = arr.filter((d) =>
        d.alias.toLowerCase().includes(ql) ||
        d.user.toLowerCase().includes(ql) ||
        d.id.toLowerCase().includes(ql) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(ql))
      );
    }
    return arr.length;
  }, [q, filter, state, devices, osFilter, tagFilter]);

  const toast = useToast();

  const handleSave = async (id, draft) => {
    // PATCH alias/notes in one shot, then sync tag membership through
    // POST/DELETE /admin/api/devices/:id/tags/:tag_id pairs (backend
    // models tags as a join table, not as a JSON field).
    const before = devices.find((d) => d.id === id);
    const prevTags = new Set(before?.tags || []);
    const nextTags = new Set(draft.tags || []);
    const added = [...nextTags].filter((t) => !prevTags.has(t));
    const removed = [...prevTags].filter((t) => !nextTags.has(t));

    const body = {};
    if (draft.alias !== undefined) body.hostname = draft.alias;
    if (draft.notes !== undefined) body.note = draft.notes;
    const hasFieldChanges = Object.keys(body).length > 0;
    const hasTagChanges = added.length > 0 || removed.length > 0;

    if (!hasFieldChanges && !hasTagChanges) {
      toast("Sin cambios que guardar", { tone: "info" });
      return;
    }

    try {
      if (hasFieldChanges) {
        await _dvApi(`/admin/api/devices/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }

      // Tags need name → id resolution against the catalog. Tags created
      // inline via TagInput hit handleCreateTag first, so by the time we
      // get here every name should already exist in tagCatalog.
      const nameToId = new Map(tagCatalog.map((t) => [t.name, t.id]));
      const failedTags = [];
      for (const name of added) {
        const tagId = nameToId.get(name);
        if (!tagId) { failedTags.push(name); continue; }
        try {
          await _dvApi(`/admin/api/devices/${id}/tags/${tagId}`, { method: "POST" });
        } catch { failedTags.push(name); }
      }
      for (const name of removed) {
        const tagId = nameToId.get(name);
        if (!tagId) continue;
        try {
          await _dvApi(`/admin/api/devices/${id}/tags/${tagId}`, { method: "DELETE" });
        } catch { failedTags.push(name); }
      }

      // Optimistic local update; the next 30 s poll re-syncs.
      setDevices((ds) => ds.map((d) => d.id === id ? { ...d, ...draft } : d));
      setSelected((s) => s && s.id === id ? { ...s, ...draft } : s);

      if (failedTags.length) {
        toast(`Guardado, pero fallaron tags: ${failedTags.join(", ")}`, { tone: "warning" });
      } else {
        toast("Cambios guardados", { tone: "success" });
      }
    } catch (err) {
      toast("No se pudo guardar — reintenta", { tone: "danger" });
    }
  };
  const handleCreateTag = async (name) => {
    if (tagCatalog.some((t) => t.name === name)) return;
    const color = TAG_PALETTE[tagCatalog.length % TAG_PALETTE.length];
    try {
      const created = await _dvApi("/admin/api/tags", {
        method: "POST",
        body: JSON.stringify({ name, color }),
      });
      setTagCatalog((cat) =>
        cat.some((t) => t.name === name) ? cat : [...cat, _dvAdaptTag(created)]
      );
    } catch (err) {
      toast(`No se pudo crear tag «${name}»`, { tone: "danger" });
    }
  };
  const handleDisconnect = async (d) => {
    try {
      await _dvApi(`/admin/api/devices/${d.id}/disconnect`, { method: "POST" });
      toast(`Forzando reconexión de ${d.alias}…`);
    } catch (err) {
      toast(`No se pudo desconectar ${d.alias}`, { tone: "danger" });
    }
  };
  const requestDelete = (d) => setDeleteTarget(d);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await _dvApi(`/admin/api/devices/${deleteTarget.id}`, { method: "DELETE" });
      setDevices((ds) => ds.filter((x) => x.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) setSelected(null);
      toast(`Dispositivo «${deleteTarget.alias}» eliminado`, { tone: "success" });
    } catch (err) {
      toast(`No se pudo eliminar ${deleteTarget.alias}`, { tone: "danger" });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleExportCsv = () => {
    // Client-side CSV — no backend round-trip needed since the table data
    // is already in memory. Filtered set respects current search / state /
    // OS / tag filters so the export matches exactly what the operator
    // sees on screen (minus pagination — we export the full filtered set).
    let arr = devices;
    if (filter === "online")  arr = arr.filter((d) => d.online);
    if (filter === "offline") arr = arr.filter((d) => !d.online);
    if (osFilter.length)  arr = arr.filter((d) => osFilter.includes(osFamily(d.os)));
    if (tagFilter.length) arr = arr.filter((d) => (d.tags || []).some((t) => tagFilter.includes(t)));
    if (q.trim()) {
      const ql = q.toLowerCase();
      arr = arr.filter((d) =>
        d.alias.toLowerCase().includes(ql) ||
        d.user.toLowerCase().includes(ql) ||
        d.id.toLowerCase().includes(ql) ||
        (d.tags || []).some((t) => t.toLowerCase().includes(ql))
      );
    }
    const filtered = arr;
    const cols = [
      { id: "alias", label: "alias" },
      { id: "user", label: "user" },
      { id: "os", label: "os" },
      { id: "ip", label: "ip" },
      { id: "ver", label: "version" },
      { id: "online", label: "online" },
      { id: "lastSeen", label: "last_seen" },
      { id: "tags", label: "tags" },
      { id: "notes", label: "notes" },
    ];
    const escape = (v) => {
      if (v === null || v === undefined) return "";
      const s = Array.isArray(v) ? v.join(";") : String(v);
      // RFC 4180: wrap in quotes if it contains comma / quote / newline,
      // and double-up internal quotes.
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [cols.map((c) => c.label).join(",")];
    for (const d of filtered) {
      lines.push(cols.map((c) => escape(d[c.id])).join(","));
    }
    // \r\n keeps Excel happy; UTF-8 BOM ensures it picks the right
    // encoding so accented characters in alias/note don't break.
    const blob = new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `rd-console-devices-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`${filtered.length} dispositivos exportados`, { tone: "success" });
  };

  const handleCreateDevice = async (form) => {
    // POST /admin/api/devices with rustdesk_id mandatory + optional fields.
    // The backend pre-registers the row; the device shows as offline until
    // its first heartbeat lands.
    const body = { rustdesk_id: form.rustdesk_id.trim() };
    if (form.hostname?.trim()) body.hostname = form.hostname.trim();
    if (form.platform?.trim()) body.platform = form.platform.trim();
    try {
      const created = await _dvApi("/admin/api/devices", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const adapted = _dvAdaptDevice(created, {});
      setDevices((ds) => [adapted, ...ds]);
      setCreateOpen(false);
      toast(`Dispositivo «${adapted.alias || adapted.id}» registrado`, { tone: "success" });
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("409") || msg.toLowerCase().includes("already exists")) {
        toast("Ese RustDesk ID ya está registrado", { tone: "danger" });
      } else {
        toast("No se pudo registrar el dispositivo", { tone: "danger" });
      }
    }
  };

  return (
    <div className="cm-page">
      <PageHeader
        title="Dispositivos"
        subtitle={`${devices.length} dispositivos · ${devices.filter((d) => d.online).length} online`}
        actions={<>
          <button className="cm-btn" onClick={handleExportCsv}><Icon name="download" size={14} /> Exportar CSV</button>
          <button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} /> Añadir dispositivo</button>
        </>}
      />

      <div className="cm-toolbar">
        <div className="cm-toolbar__search">
          <Icon name="search" />
          <input
            placeholder="Buscar por alias, usuario, ID, tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Tabs
          tabs={[
            { value: "all",     label: `Todos (${devices.length})` },
            { value: "online",  label: `Online (${devices.filter((d) => d.online).length})` },
            { value: "offline", label: `Offline (${devices.filter((d) => !d.online).length})` },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <button
            ref={filtersBtnRef}
            className={"cm-btn cm-btn--ghost" + (activeFilterCount ? " is-active" : "")}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Icon name="filter" size={14} /> Filtros
            {activeFilterCount > 0 && (
              <span style={{
                marginLeft: 4, minWidth: 18, height: 18, padding: "0 6px",
                borderRadius: 9, background: "var(--primary)", color: "#fff",
                fontSize: 11, fontWeight: 700, display: "inline-flex",
                alignItems: "center", justifyContent: "center",
              }}>{activeFilterCount}</span>
            )}
          </button>
          <PageSizeSelect value={pageSize} onChange={setPageSize} options={[10, 25, 50, 100]} />
        </div>
      </div>

      {(osFilter.length > 0 || tagFilter.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 4px 12px", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--fg-muted)", marginRight: 4 }}>Filtros activos:</span>
          {osFilter.map((os) => (
            <span key={"os-" + os} className="cm-tag cm-tag--primary" style={{ paddingRight: 4 }}>
              <Icon name="monitor" size={12} /> {os}
              <button
                onClick={() => toggleArr(setOsFilter)(os)}
                aria-label={`Quitar ${os}`}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit", padding: 0, display: "grid", placeItems: "center", marginLeft: 2 }}
              ><Icon name="x" size={12} /></button>
            </span>
          ))}
          {tagFilter.map((t) => (
            <TagChip key={"tag-" + t} name={t} color={tagColor(tagCatalog, t)} removable onRemove={() => toggleArr(setTagFilter)(t)} />
          ))}
          <button className="cm-btn cm-btn--ghost" style={{ height: 24, padding: "0 8px", fontSize: 12 }} onClick={clearAllFilters}>
            Limpiar todo
          </button>
        </div>
      )}

      <Popover
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        anchorRect={filtersBtnRef.current?.getBoundingClientRect()}
        width={340}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, margin: 0, flex: 1 }}>Filtros</h3>
          {activeFilterCount > 0 && (
            <button className="cm-btn cm-btn--ghost" style={{ height: 24, padding: "0 8px", fontSize: 12 }} onClick={clearAllFilters}>Limpiar todo</button>
          )}
        </div>
        <div style={{ padding: "14px 16px", maxHeight: 420, overflowY: "auto", display: "grid", gap: 18 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Sistema operativo</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {osOptions.map((os) => {
                const active = osFilter.includes(os);
                return (
                  <button
                    key={os}
                    onClick={() => toggleArr(setOsFilter)(os)}
                    className={active ? "cm-tag cm-tag--primary" : "cm-tag"}
                    style={{
                      cursor: "pointer",
                      background: active ? undefined : "var(--card)",
                      borderColor: active ? undefined : "var(--border)",
                      color: active ? undefined : "var(--fg)",
                    }}
                  >
                    {os}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Tags</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tagCatalog.map((t) => {
                const active = tagFilter.includes(t.name);
                return (
                  <button
                    key={t.name}
                    onClick={() => toggleArr(setTagFilter)(t.name)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 500,
                      cursor: "pointer",
                      background: active ? `color-mix(in oklab, ${colorVar(t.color)} 22%, transparent)` : "var(--card)",
                      color: active ? colorVar(t.color) : "var(--fg)",
                      border: `1px solid ${active ? `color-mix(in oklab, ${colorVar(t.color)} 50%, transparent)` : "var(--border)"}`,
                    }}
                  >
                    {t.name}
                    <span style={{ opacity: .55, marginLeft: 2, fontSize: 10 }}>{t.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Popover>

      {state === "error" && (
        <ErrorBanner
          title="No pudimos cargar los dispositivos"
          description="Comprueba tu conexión con el relay. Reintentando automáticamente…"
          action={<button className="cm-btn"><Icon name="refresh" size={14} /> Reintentar</button>}
        />
      )}

      {state === "loading" ? (
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Alias</th>
                <th>Usuario</th>
                <th>Sistema</th>
                <th>Versión</th>
                <th>IP</th>
                <th>Última conexión</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton width={12} height={12} style={{ borderRadius: "50%" }} /></td>
                  <td><Skeleton width="70%" /></td>
                  <td><Skeleton width="60%" /></td>
                  <td><Skeleton width="50%" /></td>
                  <td><Skeleton width="40%" /></td>
                  <td><Skeleton width="60%" /></td>
                  <td><Skeleton width="50%" /></td>
                  <td><Skeleton width={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : items.length === 0 ? (
        <div className="cm-card">
          <EmptyState
            icon="devices"
            title={q || filter !== "all" ? "Sin resultados" : "Aún no hay dispositivos"}
            description={q || filter !== "all"
              ? "Prueba con otros filtros o términos de búsqueda."
              : "Cuando un dispositivo se conecte al relay aparecerá aquí."}
            action={<button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={14} /> Añadir dispositivo</button>}
          />
        </div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Alias</th>
                <th>Usuario</th>
                <th>Sistema</th>
                <th>Tags</th>
                <th>IP</th>
                <th>Última conexión</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} onClick={() => setSelected(d)} style={{ cursor: "pointer" }}>
                  <td><Dot online={d.online} /></td>
                  <td>
                    <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                      {d.alias}
                      {d.notes && <span title="Tiene notas" style={{ color: "var(--fg-muted)", display: "inline-flex" }}><Icon name="message" size={12} /></span>}
                    </div>
                    <div style={{ color: "var(--fg-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{d.id}</div>
                  </td>
                  <td>{d.user}</td>
                  <td>{d.os}</td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(d.tags || []).slice(0, 3).map((t) => (
                        <TagChip key={t} name={t} color={tagColor(tagCatalog, t)} />
                      ))}
                      {(d.tags || []).length > 3 && (
                        <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>+{d.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="cm-table__cell-mono">{d.ip}</td>
                  <td style={{ color: d.online ? "var(--fg)" : "var(--fg-muted)" }}>{d.lastSeen}</td>
                  <td>
                    <_DvKebab items={[
                      { label: "Ver detalle",        icon: "eye",     onClick: () => setSelected(d) },
                      { label: "Forzar reconexión",  icon: "logout",  onClick: () => handleDisconnect(d), disabled: !d.online },
                      "sep",
                      { label: "Eliminar",           icon: "trash",   danger: true, onClick: () => requestDelete(d) },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeviceDrawer
        device={selected}
        catalog={tagCatalog}
        onClose={() => setSelected(null)}
        onSave={handleSave}
        onCreateTag={handleCreateTag}
        onRequestDelete={requestDelete}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={`Eliminar ${deleteTarget?.alias || ""}`}
        description={`Vas a eliminar el dispositivo «${deleteTarget?.alias}» del catálogo. Su entrada se borra y queda registrado en el audit log. Esta acción es irreversible.`}
        confirmLabel="Eliminar definitivamente"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={deleteTarget?.alias}
      />

      <CreateDeviceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateDevice}
      />

      {/* State quick-switch */}
      <div style={{ position: "fixed", bottom: 16, left: 16, display: "flex", gap: 6, fontSize: 11, color: "var(--fg-muted)" }}>
        <span style={{ alignSelf: "center" }}>Demo:</span>
        {["ready", "loading", "empty", "error"].map((s) => (
          <a key={s} href={`#/devices${s === "ready" ? "" : "?state=" + s}`}
             style={{
               padding: "2px 8px", borderRadius: 999,
               border: "1px solid var(--border)",
               background: state === s ? "var(--primary)" : "var(--card)",
               color: state === s ? "var(--primary-fg)" : "var(--fg-muted)",
               textDecoration: "none",
             }}>{s}</a>
        ))}
      </div>
    </div>
  );
}

