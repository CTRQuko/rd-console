// Mechanically ported from public/console/pages/Logs.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports.
//
// @ts-nocheck cleanup: the audit log row is now typed as `Log` and
// `BackendLog`. The describe-log switch keeps all its branches but the
// helper signature is now `(log: Log) => LogDescription`. The export
// path's `fmt` argument is a literal-string union so the conditional
// branches inside don't fall through.
import {
  useState, useEffect, useMemo, useRef,
  cloneElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "../components/Icon";
import {
  Tag, EmptyState,
  Drawer, ConfirmDialog, PageHeader,
  useToast,
} from "../components/primitives";

// ============================================================
// Pages — Logs / Auditoría
// Filtros, multi-select, Delete (N), Export CSV/NDJSON, drawer detalle
// ============================================================

// ─── Tipos compartidos ────────────────────────────────

type Level = "info" | "warn" | "error";
type Category = "auth" | "session" | "user_management" | "config" | "address_book";
type RangeId = "1h" | "24h" | "7d" | "30d" | "all";
type ExportFormat = "csv" | "ndjson" | "json";

interface BackendLog {
  id: number;
  created_at: string;
  action: string;
  actor_user_id?: number | null;
  actor_username?: string | null;
  to_id?: string | null;
  from_id?: string | null;
  ip?: string | null;
  payload?: string | null;
}

interface BackendLogsResponse {
  items: BackendLog[];
  total?: number;
}

interface Log {
  id: string;
  rawId: number;
  ts: number;
  tsLabel: string;
  category: Category;
  action: string;
  level: Level;
  actor: string;
  target: string;
  ip: string;
  payload: Record<string, unknown>;
}

interface LogDescription {
  headline: string;
  paragraphs: string[];
  context: string[];
}

// ─── Auth-aware fetch (Etapa 3.7) ─────────────────────
function _lgAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("cm-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string };
    return parsed?.token ?? null;
  } catch { return null; }
}

interface ApiInit extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

async function _lgApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T | null> {
  const token = _lgAuthToken();
  const headers: Record<string, string> = {
    ...(init.headers || {}),
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    try { localStorage.removeItem("cm-auth"); } catch {
      // localStorage unavailable — ignore.
    }
    window.location.hash = "/login";
    throw new Error("unauthenticated");
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Catálogo de categorías + acciones (mirror backend AUDIT_CATEGORIES) ──
// Mantenemos el shape original {category: [actions...]} que el JSX consume,
// pero los valores son los del enum AuditAction de backend/app/models/audit_log.py.
const _LOG_CATEGORIES: Category[] = ["auth", "session", "user_management", "config", "address_book"];
const _LOG_ACTIONS: Record<Category, string[]> = {
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
const _LEVEL_OF: Record<string, Level> = {
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
function _categoryForAction(action: string): Category {
  for (const [cat, actions] of Object.entries(_LOG_ACTIONS) as [Category, string[]][]) {
    if (actions.includes(action)) return cat;
  }
  return "config";
}
function _safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return { raw: s }; }
}
function _lgAdaptLog(api: BackendLog): Log {
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

interface RangeOption { id: RangeId; label: string; ms: number; }
const _RANGE_OPTS: RangeOption[] = [
  { id: "1h",  label: "Última hora", ms: 3600_000 },
  { id: "24h", label: "Últimas 24 h", ms: 86_400_000 },
  { id: "7d",  label: "Últimos 7 días", ms: 7 * 86_400_000 },
  { id: "30d", label: "Últimos 30 días", ms: 30 * 86_400_000 },
  { id: "all", label: "Todo el historial", ms: Infinity },
];

const _LEVEL_TONE: Record<Level | "default", string> = {
  info: "default", warn: "amber", error: "red", default: "default",
};
// Keys must match the backend AUDIT_CATEGORIES enum exactly so the
// dropdown sends a valid `category` query string. Stale keys ("device",
// "user", "token", "system") were leftovers from an earlier draft and
// rendered as empty <option> rows because their labels were undefined.
const _CATEGORY_LABEL: Record<Category, string> = {
  auth: "Autenticación",
  session: "Sesiones",
  user_management: "Usuarios",
  config: "Configuración",
  address_book: "Agenda",
};

// ─── Descripción humana de un evento ──────────────────
// Devuelve { headline, paragraphs[], context[] } — un texto extendido y legible,
// para que el operador entienda qué ocurrió sin tener que mirar JSON.
function _describeLog(log: Log): LogDescription {
  const a = log.actor;
  const t = log.target;
  const ip = log.ip && log.ip !== "—" ? log.ip : null;
  const p = log.payload || {};
  const fmtBytes = (n: unknown): string => {
    const num = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(num)) return String(n);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + " GB";
    if (num >= 1e6) return (num / 1e6).toFixed(1) + " MB";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + " KB";
    return num + " B";
  };
  const pickStr = (key: string): string | undefined => {
    const v = p[key];
    return typeof v === "string" ? v : undefined;
  };
  const pickNum = (key: string): number | undefined => {
    const v = p[key];
    return typeof v === "number" ? v : undefined;
  };
  const ctx: string[] = [];
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
    case "login_failed": {
      const attempts = pickNum("attempts");
      return {
        headline: `Intento de inicio de sesión fallido para ${a}.`,
        paragraphs: [
          `Se rechazó el acceso a la consola. Motivo declarado: ${pickStr("reason") || "desconocido"}.`,
          attempts !== undefined
            ? `Lleva ${attempts} intento${attempts === 1 ? "" : "s"} fallido${attempts === 1 ? "" : "s"} consecutivo${attempts === 1 ? "" : "s"}; tras varios más, la cuenta puede bloquearse automáticamente.`
            : null,
        ].filter((x): x is string => x !== null),
        context: ctx,
      };
    }
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
          `Se estableció el túnel mediante ${pickStr("protocol") || "el protocolo del relay"}${pickStr("relay") ? ` a través del nodo ${pickStr("relay")}` : ""}.`,
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
    case "file_transfer": {
      const files = pickNum("files");
      const direction = pickStr("direction");
      return {
        headline: `Transferencia de ficheros entre ${a} y ${t}.`,
        paragraphs: [
          `Se movieron ${files ?? "varios"} fichero${files === 1 ? "" : "s"} (${fmtBytes(p.bytes ?? 0)} en total) en dirección ${direction === "outbound" ? "saliente" : direction === "inbound" ? "entrante" : "indeterminada"}.`,
          "El contenido no se almacena en el relay; sólo el resumen del evento queda en auditoría.",
        ],
        context: ctx,
      };
    }
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
        headline: `${a} creó la cuenta ${pickStr("username") || t}.`,
        paragraphs: [
          `Se añadió un nuevo usuario con rol ${pickStr("role") || "no especificado"}. La contraseña inicial debe rotarse en el primer login.`,
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
interface LogDropdownProps {
  trigger: ReactElement<{ onClick?: () => void }>;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
}

function _LogDropdown({ trigger, children, align = "right", width = 220 }: LogDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {cloneElement(trigger, { onClick: () => setOpen((v) => !v) })}
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

interface DropdownItemProps {
  icon?: string;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}

function _DropdownItem({ icon, label, onClick, danger }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
        color: danger ? "#e11d48" : "var(--fg)",
        fontSize: 13, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {icon && <Icon name={icon} size={14} />} {label}
    </button>
  );
}

// ─── Drawer detalle ───────────────────────────────────
function LogDetailDrawer({ log, onClose }: { log: Log | null; onClose: () => void }) {
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

// ─── Filtros persistidos en el hash ───────────────────
// Formato `#/logs?range=24h&category=auth&action=login&q=admin`. Permite
// recargar la página o compartir el enlace conservando los filtros. Se
// usa `history.replaceState` para no inundar el back-stack del navegador
// al teclear en el cuadro de búsqueda — y para no disparar `hashchange`
// en bucle con el listener del router.
const _RANGE_IDS = new Set<RangeId>(["1h", "24h", "7d", "30d", "all"]);
const _VALID_CATEGORIES = new Set<string>(_LOG_CATEGORIES);

interface LogsFilters {
  range: RangeId;
  category: Category | "all";
  action: string;
  q: string;
}

function _readFiltersFromHash(): LogsFilters {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return { range: "7d", category: "all", action: "all", q: "" };
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const rawRange = params.get("range") as RangeId | null;
  const rawCategory = params.get("category");
  return {
    range: rawRange && _RANGE_IDS.has(rawRange) ? rawRange : "7d",
    category: rawCategory && _VALID_CATEGORIES.has(rawCategory)
      ? (rawCategory as Category)
      : "all",
    action: params.get("action") || "all",
    q: params.get("q") || "",
  };
}

function _writeFiltersToHash(filters: LogsFilters): void {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  const path = qIdx < 0 ? hash.slice(1) : hash.slice(1, qIdx);
  const params = new URLSearchParams();
  if (filters.range !== "7d") params.set("range", filters.range);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.action !== "all") params.set("action", filters.action);
  if (filters.q) params.set("q", filters.q);
  const qs = params.toString();
  const next = qs ? `#${path}?${qs}` : `#${path}`;
  if (next !== hash) {
    window.history.replaceState(null, "", next);
  }
}

// ─── Página ───────────────────────────────────────────
// Router passes `route` and `navigate` to every page; this one reads
// its filter state from `window.location.hash` directly so the props
// are accepted but unused.
interface LogsPageProps {
  route?: string;
  navigate?: (path: string) => void;
}

export function LogsPage(_props: LogsPageProps = {}) {
  // Initialise from the hash so a reload (or a shared link) lands on
  // the same filter set the user left.
  const _initialFilters = _readFiltersFromHash();
  const [logs, setLogs] = useState<Log[]>([]);
  const [range, setRange] = useState<RangeId>(_initialFilters.range);
  const [category, setCategory] = useState<Category | "all">(_initialFilters.category);
  const [action, setAction] = useState<string>(_initialFilters.action);
  const [q, setQ] = useState(_initialFilters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Log | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  // Sync filter state → hash query string. `replaceState` avoids
  // building a back-stack entry per keystroke in the search box.
  useEffect(() => {
    _writeFiltersToHash({ range, category, action, q });
  }, [range, category, action, q]);

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
      const data = await _lgApi<BackendLogsResponse>(`/admin/api/logs?${params.toString()}`);
      setLogs((data?.items || []).map(_lgAdaptLog));
    } catch {
      // silent — toast on error would be too noisy for a polling re-fetch
    }
  };
  useEffect(() => { _refresh(); }, [range, category, action]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo<Log[]>(() => {
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
  const toggleOne = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
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
      const msg = err instanceof Error ? err.message : "error";
      toast("No se pudo eliminar: " + msg, { tone: "danger" });
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
      const msg = err instanceof Error ? err.message : "error";
      toast("No se pudo vaciar: " + msg, { tone: "danger" });
    }
    clearSelection();
    setConfirmClear(false);
    _refresh();
  };

  // Server-streamed export — the backend has /admin/api/logs?format=
  // {csv,ndjson} which iterates every matching row (ignoring the 200-row
  // pagination cap) and pushes them as a streaming response. The JSON
  // path stays client-side because there's no equivalent server route.
  const exportData = async (fmt: ExportFormat) => {
    if (fmt === "json") {
      _download("audit-logs.json", JSON.stringify(visible, null, 2), "application/json");
      toast(`Exportadas ${visible.length} entradas`, { tone: "success" });
      return;
    }

    const params = new URLSearchParams();
    params.set("format", fmt);
    if (category !== "all") params.set("category", category);
    if (action !== "all") params.set("action", action);
    const rangeMs = _RANGE_OPTS.find((r) => r.id === range)?.ms ?? Infinity;
    if (rangeMs !== Infinity) {
      params.set("since", new Date(Date.now() - rangeMs).toISOString());
    }

    const token = ((): string => {
      try {
        const raw = localStorage.getItem("cm-auth") || "{}";
        const parsed = JSON.parse(raw) as { token?: string };
        return parsed.token || "";
      } catch { return ""; }
    })();

    try {
      const r = await fetch(`/admin/api/logs?${params.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const filename = fmt === "csv" ? "audit-logs.csv" : "audit-logs.ndjson";
      const mime = fmt === "csv" ? "text/csv" : "application/x-ndjson";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([blob], { type: mime }));
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast("Exportación descargada", { tone: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo exportar: ${msg}`, { tone: "danger" });
    }
  };

  const actionsForCategory = useMemo<string[]>(() => {
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
          onChange={(e) => setRange(e.target.value as RangeId)}
          style={{ width: "auto", minWidth: 0 }}
          title="Rango temporal"
        >
          {_RANGE_OPTS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select
          className="cm-select"
          value={category}
          onChange={(e) => { setCategory(e.target.value as Category | "all"); setAction("all"); }}
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

function _download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
