// Mechanically ported from public/console/pages/JoinTokens.jsx
// (Etapa 4 ESM migration). React aliases → bare hook names,
// window.X exports → named ESM exports.
//
// @ts-nocheck cleanup pass: BackendInvite mirrors the JoinTokenOut /
// JoinTokenCreateOut payloads from /admin/api/join-tokens, and Invite
// is the in-page adapted shape with the panel-derived URL. The share
// modal's regenerate flow keeps a local mirror typed as Invite | null
// so the parent only sees the persisted prefix bump.
import {
  useState, useEffect, useMemo, useRef,
  type ReactNode,
} from "react";
import { Icon } from "../components/Icon";
import {
  Tag, ConfirmDialog, PageHeader,
  useToast,
} from "../components/primitives";

// ============================================================
// Pages — Invitaciones (Join Tokens)
// Modal create + modal share (QR + URL + redes) + revocar.
// ============================================================

// ─── Tipos compartidos ────────────────────────────────

type InviteStatus = "active" | "revoked" | "expired" | "used";

interface BackendInvite {
  id: number;
  label?: string | null;
  token_prefix: string;
  // Plaintext is only present in the POST response (one-shot reveal).
  token?: string;
  created_at: string;
  expires_at?: string | null;
  status: InviteStatus;
  used_at?: string | null;
}

interface Invite {
  id: string;
  rawId: number;
  name: string;
  created: string;
  expires: string;
  status: InviteStatus;
  used: boolean;
  prefix: string;
  url: string;
  rawToken?: string;
  plaintextAvailable: boolean;
}

interface KebabAction {
  label: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}
type KebabItem = "sep" | KebabAction;

// ─── Auth-aware fetch (Etapa 3.10) ────────────────────
function _jtAuthToken(): string | null {
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

async function _jtApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T | null> {
  const token = _jtAuthToken();
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

function _jtFmtDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// JoinTokenOut → JSX shape. The full plaintext is unavailable for
// existing rows (one-shot reveal at create time); the URL therefore
// only includes the 8-char prefix and an ellipsis. Newly-created
// tokens carry the full token in `JoinTokenCreateOut.token` and the
// caller stitches the live URL.
function _jtAdaptInvite(api: BackendInvite, panelUrl: string, plaintext: string | null = null): Invite {
  const tokenForUrl = plaintext || `${api.token_prefix}…`;
  return {
    id: String(api.id),
    rawId: api.id,
    name: api.label || `token-${api.id}`,
    created: _jtFmtDate(api.created_at),
    expires: api.expires_at ? _jtFmtDate(api.expires_at) : "Nunca",
    status: api.status,
    used: !!api.used_at,
    prefix: `rdt_${api.token_prefix}…`,
    url: `${panelUrl}/join/${tokenForUrl}`,
    rawToken: plaintext ?? undefined,
    plaintextAvailable: !!plaintext,
  };
}

// QR sintético via api.qrserver.com (mockup; backend devolverá su propio SVG)
function qrSrc(text: string, size: number = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=4`;
}

// ─── Modal genérico (compartido) ────────────────────────
interface JtModalProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}

function _JtModal({ open, onClose, title, subtitle, children, footer, width = 520 }: JtModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,12,20,.55)",
      backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 24,
    }}>
      <div style={{
        width: "100%", maxWidth: width, background: "var(--card)",
        border: "1px solid var(--border)", borderRadius: 14,
        boxShadow: "0 24px 60px rgba(0,0,0,.35)", overflow: "hidden",
        display: "flex", flexDirection: "column", maxHeight: "92vh",
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

// ─── Modal: Crear invitación ───────────────────────────
interface CreateInviteForm {
  name: string;
  expires_in_minutes: number | null;
}

interface CreateInviteModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (form: CreateInviteForm) => void;
}

function CreateInviteModal({ open, onClose, onCreate }: CreateInviteModalProps) {
  const [name, setName] = useState("");
  const [exp, setExp] = useState("30");
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setName(""); setExp("30"); setError(""); } }, [open]);

  const submit = () => {
    if (!name.trim()) { setError("Pon un nombre para identificar la invitación."); return; }
    // Backend expects {label, expires_in_minutes}. Page-level handleCreate
    // does the POST + adapt; we just hand off the raw form. The
    // ShareInviteModal that opens after the create receives the live URL
    // with the plaintext token from the server response.
    const days = exp === "never" ? null : parseInt(exp, 10);
    onCreate({
      name: name.trim(),
      expires_in_minutes: days != null ? days * 24 * 60 : null,
    });
  };

  return (
    <_JtModal
      open={open}
      onClose={onClose}
      title="Nueva invitación"
      subtitle="Genera un enlace único para que un dispositivo se una al relay."
      width={460}
      footer={
        <>
          <button className="cm-btn" onClick={onClose}>Cancelar</button>
          <button className="cm-btn cm-btn--primary" onClick={submit}>
            <Icon name="plus" size={14} /> Crear invitación
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Nombre</label>
        <input
          className="cm-input"
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="p. ej. portátil-marta o tablet-recepción"
        />
        <div style={{ color: error ? "#e11d48" : "var(--fg-muted)", fontSize: 12, marginTop: 4 }}>
          {error || "Solo para identificarla en la lista y en auditoría."}
        </div>
      </div>
      <div style={{ marginBottom: 4 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Caducidad</label>
        <select className="cm-select" value={exp} onChange={(e) => setExp(e.target.value)}>
          <option value="1">24 horas</option>
          <option value="7">7 días</option>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
          <option value="never">Nunca caduca</option>
        </select>
        <div style={{ color: "var(--fg-muted)", fontSize: 12, marginTop: 4 }}>
          La invitación es de un solo uso: una vez canjeada, deja de funcionar.
        </div>
      </div>
    </_JtModal>
  );
}

// ─── Modal: Compartir invitación ───────────────────────
// Countdown desde el primer "uso" del enlace (compartir / copiar / cerrar).
// Si llega a 0, regenera url + token + prefix → el QR se refresca solo.
const _SHARE_TTL_S = 120;

function _genRawToken(): string {
  return "rdt_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

interface ShareInviteModalProps {
  invite: Invite | null;
  onClose: () => void;
  onRegenerate?: (next: Invite) => void;
}

function ShareInviteModal({ invite, onClose, onRegenerate }: ShareInviteModalProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Local mirror so we can regenerate without leaking through to the parent
  // until the user closes (we do notify via onRegenerate so the listing's
  // prefix stays in sync).
  const [live, setLive] = useState<Invite | null>(invite);
  const [deadline, setDeadline] = useState<number | null>(null); // ms timestamp; null = aún no arrancó
  const [now, setNow] = useState(() => Date.now());

  // Reset al abrir con otra invitación
  useEffect(() => {
    setLive(invite);
    setDeadline(null);
    setShowRaw(false);
    setShowQr(false);
    setCopied(null);
  }, [invite?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick mientras corra el countdown
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);

  const remaining = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  // Regenerar token cuando llega a 0
  useEffect(() => {
    if (deadline && remaining === 0) {
      const rawToken = _genRawToken();
      const url = "https://rustdesk.casaredes.cc/join/" + rawToken.slice(4, 24);
      const base = live || invite;
      if (!base) return;
      const next: Invite = { ...base, url, rawToken, prefix: rawToken.slice(0, 12) + "…" };
      setLive(next);
      setDeadline(null);
      onRegenerate?.(next);
    }
  }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return null;

  const startTimer = () => {
    if (!deadline) setDeadline(Date.now() + _SHARE_TTL_S * 1000);
  };

  const copy = (text: string, key: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
    startTimer();
  };

  const shareText = `Únete al relay con esta invitación: ${live.url}`;
  const shareLinks: Record<"email" | "telegram" | "whatsapp", string> = {
    email:    `mailto:?subject=${encodeURIComponent("Invitación a rd-console")}&body=${encodeURIComponent(shareText)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(live.url)}&text=${encodeURIComponent("Únete al relay")}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
  };

  const fmtMMSS = (s: number): string =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const lowTime = remaining !== null && remaining <= 15;

  const SHARE_BUTTONS: Array<{ id: "email" | "telegram" | "whatsapp"; label: string; icon: string; bg: string }> = [
    { id: "email",    label: "Email",    icon: "mail",     bg: "#475569" },
    { id: "telegram", label: "Telegram", icon: "telegram", bg: "#229ED9" },
    { id: "whatsapp", label: "WhatsApp", icon: "whatsapp", bg: "#25D366" },
  ];

  return (
    <_JtModal
      open={!!invite}
      onClose={onClose}
      title="Compartir invitación"
      subtitle={live.name}
      width={520}
      footer={
        <>
          <span style={{ flex: 1, color: "var(--fg-muted)", fontSize: 12 }}>
            Caduca el {live.expires}.
          </span>
          <button className="cm-btn cm-btn--primary" onClick={() => { startTimer(); onClose?.(); }}>
            <Icon name="check" size={14} /> Ya la he copiado, cerrar
          </button>
        </>
      }
    >
      {/* Banner */}
      <div style={{
        padding: 12, marginBottom: 18,
        background: lowTime
          ? "color-mix(in oklab, #e11d48 12%, transparent)"
          : "color-mix(in oklab, #d97706 10%, transparent)",
        border: lowTime
          ? "1px solid color-mix(in oklab, #e11d48 45%, transparent)"
          : "1px solid color-mix(in oklab, #d97706 35%, transparent)",
        borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start",
        transition: "background .2s, border-color .2s",
      }}>
        <Icon name="alert" size={16} />
        <div style={{ fontSize: 12, lineHeight: 1.55, flex: 1 }}>
          Esta invitación es de <strong>un solo uso</strong>. Cómpartela ahora — al recargar esta vista, el token no volverá a mostrarse.
          {remaining === null ? (
            <div style={{ marginTop: 6, color: "var(--fg-muted)" }}>
              Al compartir o copiar, este token quedará disponible {fmtMMSS(_SHARE_TTL_S)}; después se regenerará automáticamente.
            </div>
          ) : (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: lowTime ? "#e11d48" : "#b45309", fontVariantNumeric: "tabular-nums" }}>
              <Icon name="clock" size={12} />
              Se regenera en {fmtMMSS(remaining)}
            </div>
          )}
        </div>
      </div>

      {/* URL */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Enlace de invitación</label>
        <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
          <input
            readOnly
            value={live.url}
            className="cm-input"
            style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
            onFocus={(e) => e.target.select()}
          />
          <button className="cm-btn" onClick={() => copy(live.url, "url")}>
            <Icon name={copied === "url" ? "check" : "copy"} size={14} /> {copied === "url" ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {/* Share buttons */}
      <div style={{ marginBottom: 22 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>Compartir vía</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {SHARE_BUTTONS.map((s) => (
            <a
              key={s.id}
              href={shareLinks[s.id]}
              target="_blank"
              rel="noopener noreferrer"
              onClick={startTimer}
              className="cm-btn"
              style={{ justifyContent: "flex-start", gap: 10 }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 5, background: s.bg,
                display: "grid", placeItems: "center", color: "#fff",
              }}>
                <Icon name={s.icon} size={12} />
              </span>
              {s.label}
            </a>
          ))}
        </div>
      </div>

      {/* QR */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 16, background: "var(--bg-subtle)", borderRadius: 12, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          aria-label={showQr ? "Ocultar QR" : "Mostrar QR"}
          style={{
            width: 160, height: 160, background: "#fff", borderRadius: 8, padding: 10,
            display: "grid", placeItems: "center", flexShrink: 0, position: "relative",
            border: "1px solid var(--border)", cursor: "pointer", overflow: "hidden",
          }}
        >
          <img
            src={qrSrc(live.url, 220)}
            alt="QR"
            style={{
              width: "100%", height: "100%",
              filter: showQr ? "none" : "blur(10px)",
              transition: "filter .15s ease",
            }}
          />
          {!showQr && (
            <span style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontSize: 12, fontWeight: 500, color: "var(--fg)",
              background: "color-mix(in oklab, #fff 70%, transparent)",
            }}>
              <Icon name="eye" size={14} /> Mostrar
            </span>
          )}
        </button>
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>O escanea el QR</div>
          <div style={{ color: "var(--fg-muted)" }}>
            {showQr
              ? "Desde la app de RustDesk en el dispositivo destino: Ajustes → Unirse a relay → Escanear código."
              : "Click para revelar. Evita exponerlo en pantalla mientras compartes."}
          </div>
        </div>
      </div>

      {/* Token raw */}
      <details open={showRaw} onToggle={(e) => setShowRaw(e.currentTarget.open)} style={{ marginBottom: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--fg-muted)", padding: "4px 0", userSelect: "none" }}>
          {showRaw ? "Ocultar token raw" : "Mostrar token raw (avanzado)"}
        </summary>
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "stretch" }}>
          <input
            readOnly
            value={live.rawToken || live.prefix}
            className="cm-input"
            style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
            onFocus={(e) => e.target.select()}
          />
          <button className="cm-btn" onClick={() => copy(live.rawToken || live.prefix, "tok")}>
            <Icon name={copied === "tok" ? "check" : "copy"} size={14} /> {copied === "tok" ? "Copiado" : "Copiar"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 4 }}>
          Útil si vas a configurar el cliente manualmente. No lo compartas por canales no cifrados.
        </div>
      </details>
    </_JtModal>
  );
}

// ─── Menú ⋯ ───────────────────────────────────────────
function _JtKebab({ items }: { items: KebabItem[] }) {
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
      const menuH = Math.min(items.length * 36 + 16, 320);
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
        <div style={{
          position: "absolute",
          ...(openUp
            ? { bottom: "calc(100% + 4px)" }
            : { top: "calc(100% + 4px)" }),
          right: 0, zIndex: 50,
          minWidth: 180, background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,.18)", padding: 4,
        }}>
          {items.map((it, i) => it === "sep" ? (
            <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "8px 10px", borderRadius: 6, border: "none", background: "transparent",
                color: it.danger ? "#e11d48" : "var(--fg)",
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

// ─── Modal: Detalle invitación (sin raw token) ─────────
function InviteDetailsModal({ invite, onClose }: { invite: Invite | null; onClose: () => void }) {
  if (!invite) return null;
  const statusTone =
    invite.status === "active" ? "primary"
      : invite.status === "revoked" ? "default"
        : "amber";
  const statusLabel =
    invite.status === "active" ? "Activa"
      : invite.status === "revoked" ? "Revocada"
        : invite.used ? "Usada"
          : "Caducada";

  return (
    <_JtModal
      open={!!invite}
      onClose={onClose}
      title="Detalle de invitación"
      subtitle={invite.name}
      width={460}
      footer={<button className="cm-btn" onClick={onClose}>Cerrar</button>}
    >
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 18px", margin: 0, fontSize: 13 }}>
        <dt style={{ color: "var(--fg-muted)" }}>Estado</dt>
        <dd style={{ margin: 0 }}><Tag tone={statusTone}>{statusLabel}</Tag></dd>

        <dt style={{ color: "var(--fg-muted)" }}>Prefijo</dt>
        <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{invite.prefix}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>Creada</dt>
        <dd style={{ margin: 0 }}>{invite.created}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>Caduca</dt>
        <dd style={{ margin: 0 }}>{invite.expires}</dd>

        <dt style={{ color: "var(--fg-muted)" }}>ID interno</dt>
        <dd style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12 }}>{invite.id}</dd>
      </dl>

      <div style={{
        marginTop: 18, padding: 12,
        background: "var(--bg-subtle)", borderRadius: 8,
        display: "flex", gap: 10, alignItems: "flex-start",
        fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.55,
      }}>
        <Icon name="lock" size={14} />
        <div>
          El token completo solo se muestra <strong>una sola vez</strong> al crear la invitación.
          Si lo perdiste, revoca esta invitación y crea una nueva.
        </div>
      </div>
    </_JtModal>
  );
}

// ─── Página ────────────────────────────────────────────
interface JoinTokensPageProps {
  route?: string;
  navigate?: (path: string) => void;
}

interface ServerInfo {
  panel_url?: string;
}

export function JoinTokensPage(_props: JoinTokensPageProps = {}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [panelUrl, setPanelUrl] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [shareInvite, setShareInvite] = useState<Invite | null>(null);
  const [detailsInvite, setDetailsInvite] = useState<Invite | null>(null);
  const [revokeInvite, setRevokeInvite] = useState<Invite | null>(null);
  const [deleteInvite, setDeleteInvite] = useState<Invite | null>(null);
  const [showRevoked, setShowRevoked] = useState(true);
  const toast = useToast();

  const _refresh = async (currentPanelUrl?: string) => {
    try {
      const list = await _jtApi<BackendInvite[]>("/admin/api/join-tokens");
      const url = currentPanelUrl ?? panelUrl;
      setInvites((list || []).map((api) => _jtAdaptInvite(api, url)));
    } catch {
      // silent
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // panel_url drives the "join" link rendered alongside each token.
      // Falls back to window.location.origin if the operator hasn't
      // overridden the public URL via /admin/api/settings/server-info.
      let url = window.location.origin;
      try {
        const info = await _jtApi<ServerInfo>("/admin/api/settings/server-info");
        if (info?.panel_url) url = info.panel_url.replace(/\/$/, "");
      } catch {
        // silent
      }
      if (cancelled) return;
      setPanelUrl(url);
      await _refresh(url);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo<Invite[]>(
    () => showRevoked ? invites : invites.filter((i) => i.status !== "revoked"),
    [invites, showRevoked],
  );
  const stats = useMemo(() => ({
    active: invites.filter((i) => i.status === "active").length,
    used:   invites.filter((i) => i.used).length,
    expired: invites.filter((i) => i.status === "expired" || i.status === "revoked").length,
  }), [invites]);

  // The CreateInviteModal calls onCreate with a JSX-shape invite that it
  // built from a /POST response we already fetched here in handleCreate.
  // We bypass that by giving it a direct backend payload {label,
  // expires_in_minutes} and doing the POST + adapt ourselves so the
  // live URL contains the plaintext token (one-shot reveal).
  const handleCreate = async (form: CreateInviteForm) => {
    const body = {
      label: form?.name || null,
      expires_in_minutes: typeof form?.expires_in_minutes === "number" ? form.expires_in_minutes : null,
    };
    try {
      const created = await _jtApi<BackendInvite>("/admin/api/join-tokens", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!created) throw new Error("empty response");
      // `created.token` is the plaintext, only available here. Use it
      // to build the share URL with the full token; subsequent reads
      // can only use the prefix.
      const inv = _jtAdaptInvite(created, panelUrl, created.token ?? null);
      setInvites((xs) => [inv, ...xs]);
      setCreateOpen(false);
      setShareInvite(inv);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo crear: ${msg}`, { tone: "danger" });
    }
  };

  const handleRevoke = async () => {
    if (!revokeInvite) return;
    try {
      await _jtApi(`/admin/api/join-tokens/${revokeInvite.rawId}`, { method: "DELETE" });
      toast(`Invitación «${revokeInvite.name}» revocada`, { tone: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo revocar: ${msg}`, { tone: "danger" });
    }
    setRevokeInvite(null);
    _refresh();
  };

  const handleDelete = async () => {
    if (!deleteInvite) return;
    try {
      await _jtApi(`/admin/api/join-tokens/${deleteInvite.rawId}?hard=true`, { method: "DELETE" });
      toast(`Invitación «${deleteInvite.name}» eliminada definitivamente`, { tone: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      toast(`No se pudo eliminar: ${msg}`, { tone: "danger" });
    }
    setDeleteInvite(null);
    _refresh();
  };

  return (
    <div className="cm-page">
      <PageHeader
        title="Invitaciones"
        subtitle="Enlaces de un solo uso para que dispositivos nuevos se unan al relay."
        actions={
          <button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} /> Nueva invitación
          </button>
        }
      />

      {/* Stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Activas",    value: stats.active,  tone: "green" },
          { label: "Canjeadas",  value: stats.used,    tone: "default" },
          { label: "Caducadas o revocadas", value: stats.expired, tone: "default" },
        ].map((s) => (
          <div key={s.label} className="cm-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 600, marginTop: 4 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="cm-toolbar" style={{ justifyContent: "flex-end" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--fg-muted)" }}>
          <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
          Mostrar caducadas / revocadas
        </label>
      </div>

      <div className="cm-table-wrap">
        <table className="cm-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Prefijo</th>
              <th>Creada</th>
              <th>Caduca</th>
              <th>Estado</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id} onClick={() => setDetailsInvite(t)} style={{ cursor: "pointer" }}>
                <td style={{ fontWeight: 500 }}>{t.name}</td>
                <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{t.prefix}</code></td>
                <td style={{ color: "var(--fg-muted)" }}>{t.created}</td>
                <td style={{ color: t.status === "expired" ? "#e11d48" : "var(--fg)" }}>{t.expires}</td>
                <td>
                  <Tag tone={t.status === "active" ? "green" : t.status === "revoked" ? "default" : "default"}>
                    {t.status === "active" ? "activa" : t.status === "revoked" ? "revocada" : "caducada"}
                  </Tag>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <_JtKebab
                    items={[
                      { label: "Revocar",              icon: "x",     onClick: () => setRevokeInvite(t), disabled: t.status !== "active" },
                      "sep",
                      { label: "Eliminar permanente",  icon: "trash", danger: true, onClick: () => setDeleteInvite(t) },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--fg-muted)", padding: 32 }}>Aún no hay invitaciones.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateInviteModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />
      <ShareInviteModal
        invite={shareInvite}
        onClose={() => setShareInvite(null)}
        onRegenerate={(next) => {
          setInvites((list) => list.map((i) => i.id === next.id ? { ...i, prefix: next.prefix, url: next.url } : i));
          setShareInvite(next);
        }}
      />
      <InviteDetailsModal invite={detailsInvite} onClose={() => setDetailsInvite(null)} />

      <ConfirmDialog
        open={!!revokeInvite}
        onClose={() => setRevokeInvite(null)}
        onConfirm={handleRevoke}
        title={`Revocar «${revokeInvite?.name || ""}»`}
        description="Tras revocar, el enlace dejará de ser válido inmediatamente. Cualquier dispositivo que aún no se haya unido tendrá que recibir una invitación nueva. La entrada queda en la lista marcada como revocada."
        confirmLabel="Revocar"
        cancelLabel="Cancelar"
        tone="danger"
      />

      <ConfirmDialog
        open={!!deleteInvite}
        onClose={() => setDeleteInvite(null)}
        onConfirm={handleDelete}
        title={`Eliminar «${deleteInvite?.name || ""}» permanentemente`}
        description={`Vas a borrar la invitación «${deleteInvite?.name}» (token ${deleteInvite?.prefix}) de la base de datos. La eliminación queda sellada en el audit log. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar permanentemente"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={deleteInvite?.name}
      />
    </div>
  );
}
