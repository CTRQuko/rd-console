// ============================================================
// Pages — Logs / Auditoría
// Filtros, multi-select, Delete (N), Export CSV/NDJSON, drawer detalle
// ============================================================

const { useState: _lgS, useEffect: _lgE, useMemo: _lgM, useRef: _lgR } = React;

// ─── Auth-aware fetch (Etapa 3.7) ─────────────────────
function _lgAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    return raw ? (JSON.parse(raw)?.token || null) : null;
  } catch { return null; }
}
async function _lgApi(path, init = {}) {
  const token = _lgAuthToken();
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
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Catálogo de categorías + acciones (mirror backend AUDIT_CATEGORIES) ──
// Mantenemos el shape original {category: [actions...]} que el JSX consume,
// pero los valores son los del enum AuditAction de backend/app/models/audit_log.py.
const _LOG_CATEGORIES = ["auth", "session", "user_management", "config", "address_book"];
const _LOG_ACTIONS = {
  session: [
    "connect", "disconnect", "file_transfer", "close",
  ],
  auth: [
    "login", "login_failed",
    "api_token_created", "api_token_revoked",
    "join_token_created", "join_token_revoked", "join_token_deleted",
  ],
  user_management: [
    "user_created", "user_updated", "user_disabled", "user_enabled", "user_deleted",
  ],
  config: [
    "settings_changed", "settings_exported", "logs_deleted",
    "backup_exported", "backup_restored",
    "device_updated", "device_forgotten", "device_disconnect_requested",
    "device_bulk_updated",
    "tag_created", "tag_deleted", "device_tagged", "device_untagged",
  ],
  address_book: [
    "address_book_updated", "address_book_cleared",
  ],
};
const _LEVEL_OF = {
  login_failed: "error",
  user_disabled: "warn",
  user_deleted: "warn",
  join_token_revoked: "warn",
  api_token_revoked: "warn",
  logs_deleted: "warn",
  device_forgotten: "warn",
  backup_restored: "warn",
  address_book_cleared: "warn",
};

// Map an ApiAuditLog row → the JSX log shape. The backend's category is
// derived server-side from the action via AUDIT_CATEGORIES; we recompute
// here so the filter dropdown stays decoupled from the response shape.
function _categoryForAction(action) {
  for (const [cat, actions] of Object.entries(_LOG_ACTIONS)) {
    if (actions.includes(action)) return cat;
  }
  return "config";
}
function _lgAdaptLog(api) {
  const ts = new Date(api.created_at).getTime();
  const action = api.action;
  return {
    id: String(api.id),
    rawId: api.id,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    tsLabel: new Date(ts).toLocaleString("es", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }),
    category: _categoryForAction(action),
    action,
    level: _LEVEL_OF[action] || "info",
    actor: api.actor_username || (api.actor_user_id ? `user #${api.actor_user_id}` : "system"),
    target: api.to_id || api.from_id || "—",
    ip: api.ip || "—",
    payload: api.payload ? _safeParseJson(api.payload) : {},
  };
}
function _safeParseJson(s) {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}

const _RANGE_OPTS = [
  { id: "1h",  label: "Última hora", ms: 3600_000 },
  { id: "24h", label: "Últimas 24 h", ms: 86_400_000 },
  { id: "7d",  label: "Últimos 7 días", ms: 7 * 86_400_000 },
  { id: "30d", label: "Últimos 30 días", ms: 30 * 86_400_000 },
  { id: "all", label: "Todo el historial", ms: Infinity },
];

const _LEVEL_TONE = { info: "default", warn: "amber", error: "red", default: "default" };
const _CATEGORY_LABEL = { auth: "Autenticación", session: "Sesiones", device: "Dispositivos", user: "Usuarios", token: "Invitaciones", config: "Configuración", system: "Sistema" };

// ─── Descripción humana de un evento ──────────────────
// Devuelve { headline, paragraphs[], context[] } — un texto extendido y legible,
// para que el operador entienda qué ocurrió sin tener que mirar JSON.
function _describeLog(log) {
  const a = log.actor;
  const t = log.target;
  const ip = log.ip && log.ip !== "—" ? log.ip : null;
  const p = log.payload || {};
  const fmtBytes = (n) => {
    if (!Number.isFinite(n)) return String(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
    return n + " B";
  };
  const ctx = [];
  if (ip) ctx.push(`IP de origen ${ip}.`);
  ctx.push(`Registrado el ${log.tsLabel}.`);

  switch (log.action) {
    case "login":
      return {
        headline: `${a} inició sesión correctamente.`,
        paragraphs: [
          `${a} se autenticó en la consola desde ${ip ?? "una IP desconocida"} y obtuvo una sesión activa.`,
          "No se detectaron anomalías en la autenticación: credenciales válidas y, si procede, segundo factor superado.",
        ],
        context: ctx,
      };
    case "login_failed":
      return {
        headline: `Intento de inicio de sesión fallido para ${a}.`,
        paragraphs: [
          `Se rechazó el acceso a la consola. Motivo declarado: ${p.reason || "desconocido"}.`,
          p.attempts ? `Lleva ${p.attempts} intento${p.attempts === 1 ? "" : "s"} fallido${p.attempts === 1 ? "" : "s"} consecutivo${p.attempts === 1 ? "" : "s"}; tras varios más, la cuenta puede bloquearse automáticamente.` : null,
        ].filter(Boolean),
        context: ctx,
      };
    case "mfa_challenge":
      return {
        headline: `${a} pasó por una verificación adicional (MFA).`,
        paragraphs: [
          "El sistema solicitó un segundo factor durante el inicio de sesión. Esto suele ocurrir desde dispositivos o ubicaciones nuevas.",
        ],
        context: ctx,
      };
    case "logout":
      return {
        headline: `${a} cerró su sesión.`,
        paragraphs: [
          "La sesión se cerró de forma limpia. Los tokens asociados fueron invalidados.",
        ],
        context: ctx,
      };

    case "session_start":
      return {
        headline: `${a} abrió una sesión remota contra ${t}.`,
        paragraphs: [
          `Se estableció el túnel mediante ${p.protocol || "el protocolo del relay"}${p.relay ? ` a través del nodo ${p.relay}` : ""}.`,
          "A partir de aquí, todo el tráfico de pantalla, ratón y teclado pasa por el servidor. Si la sesión transfiere ficheros, quedará registrada como evento aparte.",
        ],
        context: ctx,
      };
    case "session_end":
      return {
        headline: `Sesión remota entre ${a} y ${t} finalizada.`,
        paragraphs: [
          "Se cerró el túnel de control remoto y se liberaron los recursos asociados.",
        ],
        context: ctx,
      };
    case "file_transfer":
      return {
        headline: `Transferencia de ficheros entre ${a} y ${t}.`,
        paragraphs: [
          `Se movieron ${p.files ?? "varios"} fichero${p.files === 1 ? "" : "s"} (${fmtBytes(p.bytes ?? 0)} en total) en dirección ${p.direction === "outbound" ? "saliente" : p.direction === "inbound" ? "entrante" : "indeterminada"}.`,
          "El contenido no se almacena en el relay; sólo el resumen del evento queda en auditoría.",
        ],
        context: ctx,
      };
    case "chat":
      return {
        headline: `Mensaje de chat dentro de la sesión con ${t}.`,
        paragraphs: [
          "Se intercambió al menos un mensaje en el canal de chat embebido. El cuerpo del mensaje no se persiste por privacidad.",
        ],
        context: ctx,
      };

    case "device_online":
      return {
        headline: `${t} se conectó al relay.`,
        paragraphs: [
          `El cliente RustDesk en ${t} reportó estado en línea y empezó a anunciar disponibilidad.`,
        ],
        context: ctx,
      };
    case "device_offline":
      return {
        headline: `${t} pasó a estado offline.`,
        paragraphs: [
          "El relay dejó de recibir keepalives del dispositivo. Puede estar apagado, sin red o con el agente detenido.",
        ],
        context: ctx,
      };
    case "device_added":
      return {
        headline: `Se dio de alta el dispositivo ${t}.`,
        paragraphs: [
          `${a} registró ${t} en la consola. A partir de ahora aparece en Dispositivos y puede recibir sesiones.`,
        ],
        context: ctx,
      };
    case "device_removed":
      return {
        headline: `Se eliminó el dispositivo ${t}.`,
        paragraphs: [
          `${a} retiró ${t} del inventario. El cliente, si volviera a conectarse, sería tratado como desconocido.`,
        ],
        context: ctx,
      };
    case "device_disconnect":
      return {
        headline: `${a} forzó la desconexión de ${t}.`,
        paragraphs: [
          "Se envió la orden de cerrar todas las sesiones activas y revocar el túnel actual del dispositivo.",
        ],
        context: ctx,
      };

    case "user_created":
      return {
        headline: `${a} creó la cuenta ${p.username || t}.`,
        paragraphs: [
          `Se añadió un nuevo usuario con rol ${p.role || "no especificado"}. La contraseña inicial debe rotarse en el primer login.`,
        ],
        context: ctx,
      };
    case "user_updated":
      return {
        headline: `${a} editó la cuenta ${t}.`,
        paragraphs: [
          "Se modificaron datos del usuario (rol, email, alias o permisos). Revisa el evento previo si necesitas el estado anterior.",
        ],
        context: ctx,
      };
    case "user_deleted":
      return {
        headline: `${a} eliminó la cuenta ${t}.`,
        paragraphs: [
          "Las sesiones activas del usuario se invalidan y sus tokens dejan de funcionar.",
        ],
        context: ctx,
      };
    case "user_locked":
      return {
        headline: `Cuenta ${t} bloqueada automáticamente.`,
        paragraphs: [
          "Demasiados intentos de acceso fallidos seguidos. Un administrador debe desbloquear la cuenta o esperar al periodo de cooldown.",
        ],
        context: ctx,
      };

    case "join_token_created":
      return {
        headline: `${a} generó una invitación para unirse al relay.`,
        paragraphs: [
          "Se emitió un join token de un solo uso. El valor en claro sólo se muestra una vez en la consola; después queda únicamente el prefijo en auditoría.",
        ],
        context: ctx,
      };
    case "join_token_used":
      return {
        headline: `Una invitación fue canjeada.`,
        paragraphs: [
          `Un cliente RustDesk usó el token para registrarse. Si la invitación era de un solo uso, ya no podrá reutilizarse.`,
        ],
        context: ctx,
      };
    case "join_token_revoked":
      return {
        headline: `${a} revocó una invitación.`,
        paragraphs: [
          "El token deja de aceptarse de inmediato. Cualquier dispositivo que aún no se hubiera unido tendrá que recibir una invitación nueva.",
        ],
        context: ctx,
      };

    case "config_changed":
      return {
        headline: `${a} cambió la configuración del relay.`,
        paragraphs: [
          "Se actualizó al menos una clave de configuración. Algunos cambios requieren un recarga del servicio para aplicarse.",
        ],
        context: ctx,
      };
    case "config_reload":
      return {
        headline: `Se recargó la configuración del relay.`,
        paragraphs: [
          "El servicio releyó su configuración sin reiniciar el proceso. Las sesiones en curso no se interrumpieron.",
        ],
        context: ctx,
      };

    case "throughput_spike":
      return {
        headline: `Pico de tráfico inusual en el relay.`,
        paragraphs: [
          "El throughput superó el umbral configurado. Puede deberse a transferencias masivas legítimas o a un comportamiento anómalo; conviene revisar las sesiones activas en ese intervalo.",
        ],
        context: ctx,
      };
    case "service_restart":
      return {
        headline: `El servicio del relay se reinició.`,
        paragraphs: [
          "Todas las sesiones activas se cortaron. Los clientes intentarán reconectar automáticamente al volver el servicio.",
        ],
        context: ctx,
      };

    default:
      return {
        headline: `Evento ${log.action.replaceAll("_", " ")}.`,
        paragraphs: [
          `Acción ejecutada por ${a}${t && t !== "—" ? ` sobre ${t}` : ""}.`,
        ],
        context: ctx,
      };
  }
}

// ─── Dropdown genérico (anclado al botón) ─────────────
function _LogDropdown({ trigger, children, align = "right", width = 220 }) {
  const [open, setOpen] = _lgS(false);
  const ref = _lgR(null);
  _lgE(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {React.cloneElement(trigger, { onClick: () => setOpen((v) => !v) })}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)",
          [align]: 0, zIndex: 50, minWidth: width,
          background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 4,
        }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function _DropdownItem({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
        color: danger ? "#e11d48" : "var(--fg)",
        fontSize: 13, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon && <Icon name={icon} size={14} />} {label}
    </button>
  );
}

// ─── Drawer detalle ───────────────────────────────────
function LogDetailDrawer({ log, onClose }) {
  if (!log) return null;
  const desc = _describeLog(log);
  return (
    <Drawer open={!!log} onClose={onClose} title="Detalle del evento" width={560}
      footer={<button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cerrar</button>}>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 16px", margin: 0, fontSize: 13 }}>
        <dt style={{ color: "var(--fg-muted)" }}>Cuándo</dt>
        <dd style={{ margin: 0 }}>{log.tsLabel}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>Categoría</dt>
        <dd style={{ margin: 0 }}>{_CATEGORY_LABEL[log.category]}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>Acción</dt>
        <dd style={{ margin: 0 }}>
          <Tag tone={_LEVEL_TONE[log.level]}>{log.action.replaceAll("_", " ")}</Tag>
        </dd>

        <dt style={{ color: "var(--fg-muted)" }}>Actor</dt>
        <dd style={{ margin: 0 }}>{log.actor}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>Target</dt>
        <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{log.target}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>IP origen</dt>
        <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{log.ip}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>ID</dt>
        <dd style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}>{log.id}</dd>
      </dl>

      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600, marginTop: 24, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--fg-muted)" }}>
        Descripción
      </h3>
      <div style={{
        padding: 14, background: "var(--bg-subtle)", borderRadius: 10,
        border: "1px solid var(--border)",
      }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{desc.headline}</p>
        {desc.paragraphs.map((para, i) => (
          <p key={i} style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}>
            {para}
          </p>
        ))}
        {desc.context.length > 0 && (
          <div style={{
            marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)",
            fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.55,
          }}>
            {desc.context.join(" ")}
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ─── Página ───────────────────────────────────────────
function LogsPage() {
  const [logs, setLogs] = _lgS([]);
  const [range, setRange] = _lgS("7d");
  const [category, setCategory] = _lgS("all");
  const [action, setAction] = _lgS("all");
  const [q, setQ] = _lgS("");
  const [selected, setSelected] = _lgS(new Set());
  const [detail, setDetail] = _lgS(null);
  const [confirmDelete, setConfirmDelete] = _lgS(false);
  const [confirmClear, setConfirmClear] = _lgS(false);
  const toast = useToast();

  // Server-side filtering: build the query from the active filters,
  // re-fetch on change. Backend caps `limit` at 200; client-side filtering
  // (q, range when "all") still applies on top of the server response so
  // the in-page search stays snappy.
  const _refresh = async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (category !== "all") params.set("category", category);
    if (action !== "all") params.set("action", action);
    const rangeMs = _RANGE_OPTS.find((r) => r.id === range)?.ms ?? Infinity;
    if (rangeMs !== Infinity) {
      params.set("since", new Date(Date.now() - rangeMs).toISOString());
    }
    try {
      const data = await _lgApi(`/admin/api/logs?${params.toString()}`);
      setLogs((data?.items || []).map(_lgAdaptLog));
    } catch {}
  };
  _lgE(() => { _refresh(); }, [range, category, action]);

  const visible = _lgM(() => {
    let arr = logs;
    const rangeMs = _RANGE_OPTS.find((r) => r.id === range)?.ms ?? Infinity;
    if (rangeMs !== Infinity) arr = arr.filter((l) => Date.now() - l.ts < rangeMs);
    if (category !== "all") arr = arr.filter((l) => l.category === category);
    if (action !== "all") arr = arr.filter((l) => l.action === action);
    if (q.trim()) {
      const ql = q.toLowerCase();
      arr = arr.filter((l) =>
        l.actor.toLowerCase().includes(ql) ||
        l.target.toLowerCase().includes(ql) ||
        l.action.toLowerCase().includes(ql) ||
        (l.ip || "").toLowerCase().includes(ql)
      );
    }
    return arr;
  }, [logs, range, category, action, q]);

  const allChecked = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const someChecked = visible.some((l) => selected.has(l.id));

  const toggleAll = () => {
    if (allChecked) {
      const s = new Set(selected);
      visible.forEach((l) => s.delete(l.id));
      setSelected(s);
    } else {
      const s = new Set(selected);
      visible.forEach((l) => s.add(l.id));
      setSelected(s);
    }
  };
  const toggleOne = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  const clearSelection = () => setSelected(new Set());

  const deleteSelected = async () => {
    const n = selected.size;
    const ids = [...selected]
      .map((id) => Number(id))
      .filter((x) => Number.isFinite(x));
    try {
      await _lgApi("/admin/api/logs", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      toast(`${n} ${n === 1 ? "evento eliminado" : "eventos eliminados"}`, { tone: "success" });
    } catch (err) {
      toast("No se pudo eliminar: " + err.message, { tone: "danger" });
    }
    clearSelection();
    setConfirmDelete(false);
    _refresh();
  };
  const clearAll = async () => {
    // "Vaciar todo" recolecta los IDs visibles y los borra. El backend
    // rechaza el bulk-delete si todas las filas están dentro de la ventana
    // de retención (30 días) — eso registra LOGS_DELETED y propaga skipped.
    const ids = logs.map((l) => Number(l.rawId)).filter((x) => Number.isFinite(x));
    try {
      await _lgApi("/admin/api/logs", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      toast("Auditoría vaciada — la acción ha quedado registrada", { tone: "success" });
    } catch (err) {
      toast("No se pudo vaciar: " + err.message, { tone: "danger" });
    }
    clearSelection();
    setConfirmClear(false);
    _refresh();
  };

  const exportData = (fmt) => {
    const data = visible;
    if (fmt === "csv") {
      const header = "id,timestamp,category,action,level,actor,target,ip\n";
      const rows = data.map((l) => [l.id, new Date(l.ts).toISOString(), l.category, l.action, l.level, l.actor, l.target, l.ip].join(",")).join("\n");
      _download("audit-logs.csv", header + rows, "text/csv");
    } else if (fmt === "ndjson") {
      _download("audit-logs.ndjson", data.map((l) => JSON.stringify(l)).join("\n"), "application/x-ndjson");
    } else if (fmt === "json") {
      _download("audit-logs.json", JSON.stringify(data, null, 2), "application/json");
    }
    toast(`Exportadas ${data.length} entradas`, { tone: "success" });
  };

  const actionsForCategory = _lgM(() => {
    if (category === "all") return [];
    return _LOG_ACTIONS[category] || [];
  }, [category]);

  return (
    <div className="cm-page">
      <PageHeader
        title="Auditoría"
        subtitle="Histórico inmutable de eventos del relay y la consola."
        actions={
          <_LogDropdown
            align="right"
            trigger={<button className="cm-btn"><Icon name="download" size={14} /> Exportar</button>}
          >
            <_DropdownItem icon="download" label="Exportar CSV" onClick={() => exportData("csv")} />
            <_DropdownItem icon="file" label="Exportar NDJSON" onClick={() => exportData("ndjson")} />
            <_DropdownItem icon="file" label="Exportar JSON" onClick={() => exportData("json")} />
            <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
            <_DropdownItem icon="trash" label="Vaciar todo el histórico…" danger onClick={() => setConfirmClear(true)} />
          </_LogDropdown>
        }
      />

      {/* Toolbar de filtros */}
      <div className="cm-toolbar" style={{ gap: 8 }}>
        <div className="cm-toolbar__search" style={{ flex: 1, minWidth: 200 }}>
          <Icon name="search" />
          <input placeholder="Actor, target, acción o IP…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select
          className="cm-select"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          style={{ width: "auto", minWidth: 0 }}
          title="Rango temporal"
        >
          {_RANGE_OPTS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select
          className="cm-select"
          value={category}
          onChange={(e) => { setCategory(e.target.value); setAction("all"); }}
          style={{ width: "auto", minWidth: 0, color: category === "all" ? "var(--fg-muted)" : "var(--fg)" }}
          title="Categoría"
        >
          <option value="all">Categoría: todas</option>
          {_LOG_CATEGORIES.map((c) => <option key={c} value={c}>{_CATEGORY_LABEL[c]}</option>)}
        </select>
        <select
          className="cm-select"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          disabled={category === "all"}
          style={{ width: "auto", minWidth: 0, color: action === "all" ? "var(--fg-muted)" : "var(--fg)" }}
          title="Acción"
        >
          <option value="all">Acción: todas</option>
          {actionsForCategory.map((a) => <option key={a} value={a}>{a.replaceAll("_", " ")}</option>)}
        </select>
      </div>

      {/* Barra de selección — solo cuando hay seleccionados */}
      {selected.size > 0 && (
        <div className="cm-card" style={{
          padding: "10px 16px", marginTop: 12, marginBottom: 0,
          display: "flex", alignItems: "center", gap: 12,
          background: "color-mix(in oklab, var(--primary) 8%, var(--card))",
          borderColor: "color-mix(in oklab, var(--primary) 35%, var(--border))",
        }}>
          <span style={{ fontSize: 13 }}>
            <strong>{selected.size}</strong> {selected.size === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <button className="cm-btn cm-btn--ghost" onClick={clearSelection} style={{ fontSize: 12 }}>
            Limpiar selección
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="cm-btn"
            onClick={() => setConfirmDelete(true)}
            style={{ color: "#e11d48", borderColor: "color-mix(in oklab, #e11d48 40%, var(--border))" }}
          >
            <Icon name="trash" size={14} /> Eliminar {selected.size}
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="cm-card" style={{ padding: 0, marginTop: 16, overflow: "hidden" }}>
        <div style={{
          padding: "10px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--fg-muted)",
        }}>
          <span>{visible.length} {visible.length === 1 ? "evento" : "eventos"}</span>
          {(category !== "all" || action !== "all" || range !== "7d" || q) && (
            <button
              onClick={() => { setCategory("all"); setAction("all"); setRange("7d"); setQ(""); }}
              style={{ background: "transparent", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: 12 }}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div style={{ maxHeight: 600, overflowY: "auto" }}>
          {visible.length === 0 ? (
            <EmptyState icon="logs" title="Sin eventos" description="Ningún log coincide con los filtros." />
          ) : (
            <table className="cm-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ width: 160 }}>Cuándo</th>
                  <th style={{ width: 180 }}>Acción</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th style={{ width: 120 }}>IP</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setDetail(l)}
                    style={{
                      cursor: "pointer",
                      background: selected.has(l.id) ? "color-mix(in oklab, var(--primary) 6%, transparent)" : undefined,
                    }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleOne(l.id)}
                      />
                    </td>
                    <td className="cm-table__cell-mono" style={{ color: "var(--fg-muted)", fontSize: 12 }}>{l.tsLabel}</td>
                    <td><Tag tone={_LEVEL_TONE[l.level]}>{l.action.replaceAll("_", " ")}</Tag></td>
                    <td>{l.actor}</td>
                    <td className="cm-table__cell-mono">{l.target}</td>
                    <td className="cm-table__cell-mono" style={{ color: "var(--fg-muted)" }}>{l.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Drawer detalle */}
      <LogDetailDrawer log={detail} onClose={() => setDetail(null)} />

      {/* Confirmaciones */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSelected}
        title={`Eliminar ${selected.size} ${selected.size === 1 ? "evento" : "eventos"}`}
        description="Vas a borrar permanentemente estos registros. Por defecto los logs son inmutables — esta acción se registra en sí misma."
        confirmLabel={`Eliminar ${selected.size}`}
        cancelLabel="Cancelar"
        tone="danger"
      />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        title="Vaciar TODA la auditoría"
        description="Vas a eliminar el historial completo del relay. Es irreversible y deja la consola sin trazabilidad previa. Útil solo si vas a redeployar limpio."
        confirmLabel="Vaciar todo"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm="VACIAR"
      />
    </div>
  );
}

function _download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

window.LogsPage = LogsPage;
