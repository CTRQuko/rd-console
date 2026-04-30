// Mechanically ported from public/console/pages/Users.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports.
//
// @ts-nocheck cleanup pass: BackendUser mirrors the ApiUser the backend
// returns from /admin/api/users; the page-level User shape adds the
// derived `status` (active / invited / disabled), pretty-printed
// last-seen, and the rawId we use for PATCH/DELETE round-trips.
import {
  useState, useEffect, useMemo, useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { Icon } from "../components/Icon";
import {
  Tag, PageHeader,
  Drawer,
  useToast,
} from "../components/primitives";

// ============================================================
// Pages — Users (operadores de la consola)
// Lista + bulk actions + create/edit/delete modales + menú ⋯
// Soporta props.embedded para uso dentro de Ajustes → Usuarios.
// ============================================================

// ─── Tipos compartidos ────────────────────────────────

type Status = "active" | "invited" | "disabled";

interface BackendUser {
  id: number;
  username: string;
  email?: string | null;
  role: string;
  is_active: boolean;
  last_login_at?: string | null;
  created_at: string;
}

interface BackendMe {
  id: number;
  username: string;
  email?: string | null;
  role: string;
}

interface User {
  id: string;
  rawId: number;
  username: string;
  email: string;
  role: string;
  status: Status;
  last: string;
  created: string;
  is_active: boolean;
}

interface RoleOption {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
}

interface KebabAction {
  label: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}
type KebabItem = "sep" | KebabAction;

// `window.RD_AVAILABLE_ROLES` is set by the Settings/Roles panel when it
// loads — that page caches the catalogue so other pages can render
// the role picker without re-fetching. The fallback covers the case
// where Users opens before Settings has run.
declare global {
  interface Window {
    RD_AVAILABLE_ROLES?: RoleOption[];
  }
}

// ─── Auth-aware fetch + adapters (Etapa 3.6) ──────────
function _usAuthToken(): string | null {
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

async function _usApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T | null> {
  const token = _usAuthToken();
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

function _usFmtRelative(ts: string | null | undefined): string {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "—";
  const dt = Math.max(0, (Date.now() - t) / 1000);
  if (dt < 60) return "Ahora";
  if (dt < 3600) return `Hace ${Math.floor(dt / 60)} min`;
  if (dt < 86400) return `Hace ${Math.floor(dt / 3600)} h`;
  const days = Math.floor(dt / 86400);
  if (days < 14) return `Hace ${days} d`;
  return `Hace ${Math.floor(days / 7)} sem`;
}
function _usFmtDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ApiUser → JSX shape: status derives from is_active and last_login_at.
// "invited" means the account was created but never logged in.
function _usAdapt(api: BackendUser): User {
  const status: Status = !api.is_active
    ? "disabled"
    : (api.last_login_at ? "active" : "invited");
  return {
    id: String(api.id),
    rawId: api.id,
    username: api.username,
    email: api.email || "—",
    role: api.role,
    status,
    last: _usFmtRelative(api.last_login_at),
    created: _usFmtDate(api.created_at),
    is_active: api.is_active,
  };
}

// ─── Pequeño dropdown menu ─────────────────────────────────
interface MenuKebabProps { items: KebabItem[]; align?: "left" | "right"; }
function MenuKebab({ items, align = "right" }: MenuKebabProps) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
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
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={toggle}>
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" style={{
          position: "absolute",
          ...(openUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
          [align]: 0, zIndex: 50,
          minWidth: 200, background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.18)",
          padding: 4, display: "flex", flexDirection: "column",
        }}>
          {items.map((it, i) => it === "sep" ? (
            <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
                color: it.danger ? "var(--rose-600, #e11d48)" : "var(--fg)",
                fontSize: 13, textAlign: "left", cursor: it.disabled ? "not-allowed" : "pointer",
                opacity: it.disabled ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--bg-subtle)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {it.icon && <Icon name={it.icon} size={14} />} {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal genérico ────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

function Modal({ open, onClose, title, subtitle, children, footer, width = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(8,12,20,.55)", backdropFilter: "blur(2px)",
      display: "grid", placeItems: "center", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: width, background: "var(--card)",
        border: "1px solid var(--border)", borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,.35)", overflow: "hidden",
        display: "flex", flexDirection: "column", maxHeight: "90vh",
      }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
            {subtitle && <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>{subtitle}</p>}
          </div>
          <button className="cm-btn cm-btn--ghost cm-btn--icon" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", background: "var(--bg-subtle)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form fields ─────────────────────────────────────────
interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

function Field({ label, hint, error, children }: FieldProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{label}</label>
      {children}
      {hint && !error && <div style={{ color: "var(--fg-muted)", fontSize: 12, marginTop: 4 }}>{hint}</div>}
      {error && <div style={{ color: "var(--rose-600, #e11d48)", fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ─── Modal crear / editar ──────────────────────────────────
interface UserForm {
  username: string;
  email: string;
  role: string;
  password: string;
  confirm: string;
}

interface UserFormModalProps {
  open: boolean;
  mode: "create" | "edit";
  user?: User | null;
  onClose: () => void;
  onSubmit: (form: UserForm) => void;
  currentUserId: string | null;
}

function UserFormModal({ open, mode, user, onClose, onSubmit, currentUserId }: UserFormModalProps) {
  const isEdit = mode === "edit";
  const isSelf = user?.id === currentUserId;
  const [form, setForm] = useState<UserForm>({ username: "", email: "", role: "user", password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof UserForm, string>>>({});
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        username: user?.username || "",
        email: user?.email && user.email !== "—" ? user.email : "",
        role: user?.role || "user",
        password: "",
        confirm: "",
      });
      setErrors({});
    }
  }, [open, user]);

  const validate = (): boolean => {
    const e: Partial<Record<keyof UserForm, string>> = {};
    if (!form.username.trim()) e.username = "Requerido";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Email inválido";
    if (!isEdit) {
      if (form.password.length < 12) e.password = "Mínimo 12 caracteres";
      if (form.password !== form.confirm) e.confirm = "No coincide";
    } else if (form.password) {
      if (form.password.length < 12) e.password = "Mínimo 12 caracteres";
      if (form.password !== form.confirm) e.confirm = "No coincide";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar ${user?.username || "operador"}` : "Nuevo operador"}
      footer={
        <>
          <button className="cm-btn cm-btn--primary" onClick={() => { if (validate()) onSubmit(form); }}>
            {isEdit ? "Guardar cambios" : "Crear operador"}
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </>
      }
    >
      <p style={{ color: "var(--fg-muted)", fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        {isEdit ? "Modifica email, rol o contraseña." : "Crea una cuenta de operador para esta consola."}
      </p>
      <Field label="Nombre de usuario" hint="Solo letras, números, guiones. Único." error={errors.username}>
        <input
          className="cm-input"
          autoFocus={!isEdit}
          disabled={isEdit}
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.replace(/[^a-z0-9_-]/gi, "").toLowerCase() }))}
          placeholder="p. ej. operador1"
        />
      </Field>
      <Field label="Email (opcional)" hint="Para notificaciones y reset de contraseña." error={errors.email}>
        <input
          className="cm-input"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="operador@empresa.cc"
        />
      </Field>
      <Field
        label="Rol"
        hint={isSelf ? "No puedes cambiar tu propio rol. Pídeselo a otro admin." : "admin tiene acceso total · user tiene acceso restringido."}
      >
        <select
          className="cm-select"
          value={form.role}
          disabled={isSelf}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
        >
          <option value="admin">admin</option>
          <option value="user">user</option>
        </select>
      </Field>
      <Field
        label={isEdit ? "Nueva contraseña (opcional)" : "Contraseña"}
        hint="Mínimo 12 caracteres. Se almacena con argon2id."
        error={errors.password}
      >
        <div style={{ position: "relative" }}>
          <input
            className="cm-input"
            type={showPass ? "text" : "password"}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder={isEdit ? "Dejar en blanco para no cambiar" : "Mínimo 12 caracteres"}
            style={{ paddingRight: 80 }}
          />
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            style={{ position: "absolute", right: 8, top: 6, fontSize: 12, color: "var(--fg-muted)", background: "transparent", border: "none", cursor: "pointer" }}
          >
            {showPass ? "Ocultar" : "Mostrar"}
          </button>
        </div>
      </Field>
      {(form.password || !isEdit) && (
        <Field label="Confirmar contraseña" error={errors.confirm}>
          <input
            className="cm-input"
            type={showPass ? "text" : "password"}
            value={form.confirm}
            onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
          />
        </Field>
      )}
    </Drawer>
  );
}

// ─── Confirm delete ────────────────────────────────────────
interface DeleteUserModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onConfirm: (u: User) => void;
}

function DeleteUserModal({ open, user, onClose, onConfirm }: DeleteUserModalProps) {
  const [confirmText, setConfirmText] = useState("");
  useEffect(() => { if (open) setConfirmText(""); }, [open]);
  if (!user) return null;
  const ok = confirmText === user.username;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Eliminar ${user.username}`}
      subtitle="Esta acción es irreversible."
      width={460}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button
            className="cm-btn"
            disabled={!ok}
            onClick={() => onConfirm(user)}
            style={{
              background: ok ? "var(--rose-600, #e11d48)" : undefined,
              color: ok ? "#fff" : undefined,
              borderColor: ok ? "var(--rose-600, #e11d48)" : undefined,
            }}
          >
            <Icon name="trash" size={14} /> Eliminar definitivamente
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </div>
      }
    >
      <div style={{ padding: 14, background: "color-mix(in oklab, var(--rose-500, #e11d48) 8%, transparent)", border: "1px solid color-mix(in oklab, var(--rose-500, #e11d48) 30%, transparent)", borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Icon name="alert" size={16} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            Vas a eliminar al operador <strong>{user.username}</strong> ({user.email || "sin email"}).
            <br />Sus dispositivos quedan, pero el historial de auditoría retiene su nombre.
          </div>
        </div>
      </div>
      <Field label={<>Para confirmar, escribe <code>{user.username}</code></>}>
        <input
          className="cm-input"
          autoFocus
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

// ─── Assign role ────────────────────────────────────────────
const _DEFAULT_ROLES: RoleOption[] = [
  { id: "admin", name: "admin", description: "Acceso total." },
  { id: "user", name: "user", description: "Acceso de solo lectura." },
];

interface RoleAssignModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onConfirm: (u: User, role: string) => void;
  currentUserId: string | null;
}

function RoleAssignModal({ open, user, onClose, onConfirm, currentUserId }: RoleAssignModalProps) {
  const availableRoles: RoleOption[] =
    (typeof window !== "undefined" && window.RD_AVAILABLE_ROLES) || _DEFAULT_ROLES;
  const [pick, setPick] = useState<string>(user?.role || availableRoles[0]?.id || "user");
  useEffect(() => {
    if (open) setPick(user?.role || availableRoles[0]?.id || "user");
  }, [open, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  const changed = pick !== user.role;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cambiar rol · ${user.username}`}
      subtitle="El cambio se aplica de inmediato a las próximas sesiones."
      width={520}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button
            className="cm-btn cm-btn--primary"
            disabled={!changed || isSelf}
            onClick={() => onConfirm(user, pick)}
          >
            <Icon name="check" size={14} /> Aplicar
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </div>
      }
    >
      {isSelf && (
        <div style={{ padding: 12, marginBottom: 14, background: "color-mix(in oklab, var(--amber-500, #f59e0b) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--amber-500, #f59e0b) 30%, transparent)", borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Icon name="alert" size={16} />
          <div style={{ fontSize: 13 }}>No puedes cambiar tu propio rol. Pide a otro administrador que lo haga por ti.</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {availableRoles.map((r) => {
          const checked = pick === r.id;
          return (
            <label
              key={r.id}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "12px 14px", borderRadius: 8,
                border: `1px solid ${checked ? "var(--primary)" : "var(--border)"}`,
                background: checked ? "color-mix(in oklab, var(--primary) 6%, transparent)" : "transparent",
                cursor: isSelf ? "not-allowed" : "pointer",
                opacity: isSelf ? 0.6 : 1,
              }}
            >
              <input
                type="radio"
                name="role"
                checked={checked}
                disabled={isSelf}
                onChange={() => setPick(r.id)}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  {r.builtin && <Tag tone="default">built-in</Tag>}
                  {r.id === user.role && <Tag tone="primary">actual</Tag>}
                </div>
                {r.description && (
                  <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.45 }}>{r.description}</div>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

// ─── Confirm enable / disable ──────────────────────────────
interface StatusConfirmModalProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onConfirm: (u: User) => void;
}

function StatusConfirmModal({ open, user, onClose, onConfirm }: StatusConfirmModalProps) {
  if (!user) return null;
  const willEnable = user.status === "disabled";
  const action = willEnable ? "Activar" : "Deshabilitar";
  const tone = willEnable ? "var(--green-600, #16a34a)" : "var(--amber-600, #d97706)";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${action} ${user.username}`}
      subtitle={willEnable ? "El operador podrá iniciar sesión otra vez." : "El operador no podrá iniciar sesión hasta que vuelvas a activarlo."}
      width={440}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button
            className="cm-btn"
            onClick={() => onConfirm(user)}
            style={{ background: tone, color: "#fff", borderColor: tone }}
          >
            <Icon name={willEnable ? "check" : "x"} size={14} /> {action}
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </div>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--fg-muted)" }}>
        {willEnable ? (
          <>Vas a reactivar a <strong style={{ color: "var(--fg)" }}>{user.username}</strong> ({user.email || "sin email"}). Sus permisos y rol se mantienen intactos.</>
        ) : (
          <>Vas a deshabilitar a <strong style={{ color: "var(--fg)" }}>{user.username}</strong>. Sus sesiones activas se cerrarán inmediatamente y no podrá volver a iniciar sesión.</>
        )}
      </div>
    </Modal>
  );
}

// ─── Filtros persistidos en el hash ───────────────────
// Misma idea que en Logs/Devices: el cuadro de búsqueda se sincroniza
// con `?q=…` en el hash via `replaceState`, así un refresh o un enlace
// compartido conserva la query. La página embedded (Settings → Usuarios)
// no toca la URL — vive bajo `#/settings/...` y comparte query string
// con el sub-panel.
function _usReadQ(): string {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx < 0) return "";
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get("q") || "";
}

function _usWriteQ(q: string): void {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  const path = qIdx < 0 ? hash.slice(1) : hash.slice(1, qIdx);
  const existing = qIdx < 0 ? new URLSearchParams() : new URLSearchParams(hash.slice(qIdx + 1));
  if (q) existing.set("q", q); else existing.delete("q");
  const qs = existing.toString();
  const next = qs ? `#${path}?${qs}` : `#${path}`;
  if (next !== hash) {
    window.history.replaceState(null, "", next);
  }
}

// ─── Página ────────────────────────────────────────────────
export interface UsersPageProps {
  embedded?: boolean;
  // Router passes these but the Users page doesn't read them directly.
  route?: string;
  navigate?: (path: string) => void;
}

export function UsersPage({ embedded = false }: UsersPageProps = {}) {
  const [q, setQ] = useState(() => embedded ? "" : _usReadQ());
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<BackendMe | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [statusUser, setStatusUser] = useState<User | null>(null);
  const [roleUser, setRoleUser] = useState<User | null>(null);
  const toast = useToast();

  // Identify the logged-in user so the UI prevents self-disable / self-role-change
  // (the backend also enforces both — see users.py _assert_not_last_admin_gone).
  const CURRENT_USER_ID = me ? String(me.id) : null;

  // Sync `q` → hash. Skipped in embedded mode because the Settings
  // panel owns the URL and shouldn't share a `q` namespace.
  useEffect(() => {
    if (embedded) return;
    _usWriteQ(q);
  }, [q, embedded]);

  // Initial load + 30 s poll keeps last_login_at fresh.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [list, whoami] = await Promise.all([
          _usApi<BackendUser[]>("/admin/api/users"),
          _usApi<BackendMe>("/api/auth/me").catch(() => null),
        ]);
        if (cancelled) return;
        setUsers((list || []).map(_usAdapt));
        if (whoami) setMe(whoami);
      } catch {
        // swallow; next tick retries
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const items = useMemo<User[]>(() => {
    if (!q.trim()) return users;
    const ql = q.toLowerCase();
    return users.filter((u) =>
      u.username.toLowerCase().includes(ql) || (u.email || "").toLowerCase().includes(ql),
    );
  }, [q, users]);

  const allSelected = items.length > 0 && items.every((u) => selected.has(u.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set([...selected].filter((id) => !items.some((u) => u.id === id))));
    } else {
      setSelected(new Set([...selected, ...items.map((u) => u.id)]));
    }
  };
  const toggleOne: Dispatch<string> = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const _refresh = async () => {
    try {
      const list = await _usApi<BackendUser[]>("/admin/api/users");
      setUsers((list || []).map(_usAdapt));
    } catch {
      // silent
    }
  };

  const bulkAction = async (action: "enable" | "disable" | "delete") => {
    const ids = [...selected]
      .filter((id) => id !== CURRENT_USER_ID || action === "enable")
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) { setSelected(new Set()); return; }
    try {
      await _usApi("/admin/api/users/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, action }),
      });
    } catch {
      // silent
    }
    setSelected(new Set());
    _refresh();
  };

  const handleCreate = async (form: UserForm) => {
    try {
      await _usApi("/admin/api/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          email: form.email || null,
          password: form.password || "changeme123",
          role: form.role || "user",
        }),
      });
      setCreateOpen(false);
      _refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo crear el usuario: ${msg}`, { tone: "danger" });
    }
  };
  const handleEdit = async (form: UserForm) => {
    if (!editUser) return;
    const body: Record<string, unknown> = {};
    if (form.email !== undefined) body.email = form.email || null;
    if (form.role !== undefined && editUser.id !== CURRENT_USER_ID) body.role = form.role;
    if (form.password) body.password = form.password;
    try {
      await _usApi(`/admin/api/users/${editUser.rawId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEditUser(null);
      _refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo guardar: ${msg}`, { tone: "danger" });
    }
  };
  const handleDelete = async (u: User) => {
    try {
      await _usApi(`/admin/api/users/${u.rawId}`, { method: "DELETE" });
      _refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo eliminar: ${msg}`, { tone: "danger" });
    } finally {
      setDeleteUser(null);
    }
  };
  const toggleStatus = (u: User) => {
    if (u.id === CURRENT_USER_ID && u.status !== "disabled") return;
    setStatusUser(u);
  };
  const confirmStatus = async (u: User) => {
    const next = u.status === "disabled";  // currently disabled => enable next
    try {
      await _usApi(`/admin/api/users/${u.rawId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      });
      _refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo cambiar el estado: ${msg}`, { tone: "danger" });
    } finally {
      setStatusUser(null);
    }
  };
  const confirmRole = async (u: User, newRole: string) => {
    try {
      await _usApi(`/admin/api/users/${u.rawId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      _refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo cambiar el rol: ${msg}`, { tone: "danger" });
    } finally {
      setRoleUser(null);
    }
  };
  const resetPass = async (u: User) => {
    const newp = window.prompt(`Nueva contraseña para ${u.username} (mín. 8):`);
    if (!newp || newp.length < 8) return;
    try {
      await _usApi(`/admin/api/users/${u.rawId}`, {
        method: "PATCH",
        body: JSON.stringify({ password: newp }),
      });
      toast(`Contraseña actualizada para ${u.username}.`, { tone: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo resetear: ${msg}`, { tone: "danger" });
    }
  };

  const roleTone = (r: string): string => r === "admin" ? "primary" : "default";
  const statusTone = (s: Status): string => s === "active" ? "green" : s === "invited" ? "primary" : "default";

  const Header = embedded ? null : (
    <PageHeader
      title="Usuarios"
      subtitle="Operadores con acceso a esta consola."
      actions={
        <button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} /> Nuevo operador
        </button>
      }
    />
  );

  const EmbeddedHeader = !embedded ? null : (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 16 }}>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: 0, maxWidth: 560 }}>
        Operadores con acceso a esta consola. Crea, deshabilita o elimina cuentas y resetea contraseñas.
      </p>
      <button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}>
        <Icon name="plus" size={14} /> Nuevo operador
      </button>
    </div>
  );

  const body = (
    <>
      {Header}
      {EmbeddedHeader}
      <div className="cm-toolbar">
        <div className="cm-toolbar__search">
          <Icon name="search" />
          <input placeholder="Buscar por usuario o email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", color: "var(--fg-muted)", fontSize: 13 }}>
            <span>{selected.size} seleccionado{selected.size === 1 ? "" : "s"}</span>
            <button className="cm-btn" onClick={() => bulkAction("enable")}>Activar</button>
            <button className="cm-btn" onClick={() => bulkAction("disable")}>Deshabilitar</button>
            <button className="cm-btn" onClick={() => bulkAction("delete")} style={{ color: "var(--rose-600, #e11d48)" }}>
              <Icon name="trash" size={14} /> Eliminar
            </button>
            <button className="cm-btn cm-btn--ghost" onClick={() => setSelected(new Set())}>Limpiar</button>
          </div>
        )}
      </div>
      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                />
              </th>
              <th>Usuario</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Última actividad</th>
              <th>Creado</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr
                key={u.id}
                onClick={(e) => {
                  // Ignore clicks on interactive elements (checkbox, kebab menu, buttons)
                  if ((e.target as HTMLElement).closest('input, button, [role="button"], a, .cm-menu, .cm-kebab')) return;
                  setEditUser(u);
                }}
                style={{
                  background: selected.has(u.id) ? "color-mix(in oklab, var(--primary) 6%, transparent)" : undefined,
                  cursor: "pointer",
                }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleOne(u.id)} />
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--violet-500, #7c3aed), var(--blue-600, #2563eb))",
                      display: "grid", placeItems: "center",
                      color: "#fff", fontSize: 11, fontWeight: 600,
                      fontFamily: "var(--font-display)",
                    }}>{(u.username || "?").slice(0, 2).toUpperCase()}</div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 500 }}>{u.username}</span>
                      {u.id === CURRENT_USER_ID && <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>tú</span>}
                    </div>
                  </div>
                </td>
                <td style={{ color: "var(--fg-muted)" }}>{u.email && u.email !== "—" ? u.email : <em style={{ opacity: 0.6 }}>—</em>}</td>
                <td
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (u.id === CURRENT_USER_ID) return;
                    setRoleUser(u);
                  }}
                  title={u.id === CURRENT_USER_ID ? "No puedes cambiar tu propio rol" : "Doble click para cambiar el rol"}
                  style={{ cursor: u.id === CURRENT_USER_ID ? "not-allowed" : "pointer", userSelect: "none" }}
                >
                  <Tag tone={roleTone(u.role)}>{u.role}</Tag>
                </td>
                <td
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    toggleStatus(u);
                  }}
                  title={u.id === CURRENT_USER_ID && u.status !== "disabled" ? "No puedes deshabilitarte a ti mismo" : "Doble click para " + (u.status === "disabled" ? "activar" : "deshabilitar")}
                  style={{ cursor: u.id === CURRENT_USER_ID && u.status !== "disabled" ? "not-allowed" : "pointer", userSelect: "none" }}
                >
                  <Tag tone={statusTone(u.status)}>{u.status}</Tag>
                </td>
                <td>{u.last}</td>
                <td style={{ color: "var(--fg-muted)" }}>{u.created}</td>
                <td>
                  <MenuKebab
                    items={[
                      { label: "Editar", icon: "edit", onClick: () => setEditUser(u) },
                      { label: "Resetear contraseña", icon: "refresh", onClick: () => resetPass(u) },
                      "sep",
                      {
                        label: u.status === "disabled" ? "Activar" : "Deshabilitar",
                        icon: u.status === "disabled" ? "check" : "x",
                        onClick: () => toggleStatus(u),
                        disabled: u.id === CURRENT_USER_ID && u.status !== "disabled",
                      },
                      "sep",
                      { label: "Eliminar", icon: "trash", danger: true, onClick: () => setDeleteUser(u), disabled: u.id === CURRENT_USER_ID },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--fg-muted)", padding: 32 }}>Sin resultados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <UserFormModal
        open={createOpen}
        mode="create"
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        currentUserId={CURRENT_USER_ID}
      />
      <UserFormModal
        open={!!editUser}
        mode="edit"
        user={editUser}
        onClose={() => setEditUser(null)}
        onSubmit={handleEdit}
        currentUserId={CURRENT_USER_ID}
      />
      <DeleteUserModal
        open={!!deleteUser}
        user={deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
      />
      <StatusConfirmModal
        open={!!statusUser}
        user={statusUser}
        onClose={() => setStatusUser(null)}
        onConfirm={confirmStatus}
      />
      <RoleAssignModal
        open={!!roleUser}
        user={roleUser}
        onClose={() => setRoleUser(null)}
        onConfirm={confirmRole}
        currentUserId={CURRENT_USER_ID}
      />
    </>
  );

  if (embedded) return <div>{body}</div>;
  return <div className="cm-page">{body}</div>;
}
