// ============================================================
// Pages — Settings
// Sub-routes via URL: /settings/general | /auth | /network | /storage | /updates
// Side-tab nav inside the page; each panel uses .cm-form-row.
// ============================================================

const { useState: _stS, useMemo: _stM, useEffect: _stE } = React;

// ─── Auth-aware fetch (Etapa 3.8) ────────────────────────
function _stAuthToken() {
  try {
    const raw = localStorage.getItem("cm-auth");
    return raw ? (JSON.parse(raw)?.token || null) : null;
  } catch { return null; }
}
async function _stApi(path, init = {}) {
  const token = _stAuthToken();
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

function _stFmtRelative(ts) {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "—";
  const dt = Math.max(0, (Date.now() - t) / 1000);
  if (dt < 60) return "ahora";
  if (dt < 3600) return `hace ${Math.floor(dt / 60)} min`;
  if (dt < 86400) return `hace ${Math.floor(dt / 3600)} h`;
  return `hace ${Math.floor(dt / 86400)} d`;
}
function _stFmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const SETTINGS_TABS = [
  { id: "general",   label: "General",         icon: "globe",    path: "/settings/general" },
  { id: "servidor",  label: "Servidor",        icon: "network",  path: "/settings/servidor" },
  { id: "usuarios",  label: "Usuarios",        icon: "users",    path: "/settings/usuarios" },
  { id: "roles",     label: "Roles & permisos", icon: "key",     path: "/settings/roles" },
  { id: "seguridad", label: "Seguridad",       icon: "shield",   path: "/settings/seguridad" },
  { id: "updates",   label: "Actualizaciones", icon: "refresh",  path: "/settings/updates" },
];

function SettingsNav({ active, onNav }) {
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {SETTINGS_TABS.map((t) => (
        <a
          key={t.id}
          href={"#" + t.path}
          onClick={(e) => { e.preventDefault(); onNav(t.path); }}
          aria-current={active === t.id ? "page" : undefined}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            color: active === t.id ? "var(--primary)" : "var(--fg)",
            background: active === t.id ? "color-mix(in oklab, var(--primary) 10%, var(--card))" : "transparent",
            fontWeight: active === t.id ? 500 : 400,
            fontSize: 14,
            textDecoration: "none",
            border: "1px solid transparent",
          }}
        >
          <Icon name={t.icon} size={16} />
          {t.label}
        </a>
      ))}
    </nav>
  );
}

// ─── General ─────────────────────────────────────────
function GeneralPanel({ theme, setTheme }) {
  const [name, setName] = _stS("Acme Relay");
  const [url, setUrl] = _stS("https://relay.acme.io");
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>General</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Identidad y preferencias del operador.</p>
      </div>
      <div style={{ padding: "0 20px" }}>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Nombre del relay</h3>
            <p>Aparece en el topbar y en notificaciones.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>URL pública</h3>
            <p>El endpoint que los clientes usan para conectarse.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" value={url} onChange={(e) => setUrl(e.target.value)} />
            <span className="cm-help">Debe incluir el esquema (https://).</span>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Idioma</h3>
            <p>Idioma de la consola de administración.</p>
          </div>
          <div className="cm-form-row__control">
            <select className="cm-select" defaultValue="es">
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Tema</h3>
            <p>Claro / oscuro · acento · densidad.</p>
          </div>
          <div className="cm-form-row__control">
            <div style={{ display: "flex", gap: 8 }}>
              {["light", "dark"].map((m) => (
                <button
                  key={m}
                  className={"cm-btn" + (theme.mode === m ? " cm-btn--primary" : "")}
                  onClick={() => setTheme((t) => ({ ...t, mode: m }))}
                >
                  <Icon name={m === "dark" ? "moon" : "sun"} size={14} /> {m === "dark" ? "Oscuro" : "Claro"}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {["blue", "violet", "green", "amber", "rose", "slate"].map((a) => (
                <button
                  key={a}
                  onClick={() => setTheme((t) => ({ ...t, accent: a }))}
                  aria-label={a}
                  title={a}
                  style={{
                    width: 28, height: 28, borderRadius: 8,
                    border: theme.accent === a ? "2px solid var(--fg)" : "1px solid var(--border)",
                    background: ({ blue: "#2563eb", violet: "#7c3aed", green: "#16a34a", amber: "#d97706", rose: "#e11d48", slate: "#475569" })[a],
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {[
                { id: "compact",     label: "Compacto" },
                { id: "default",     label: "Normal" },
                { id: "comfortable", label: "Cómodo" },
              ].map((d) => (
                <button
                  key={d.id}
                  className={"cm-btn" + (theme.density === d.id ? " cm-btn--primary" : "")}
                  onClick={() => setTheme((t) => ({ ...t, density: d.id }))}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Servidor (host hbbs/hbbr, claves, TLS, DB) ─────────
function ServidorPanel() {
  const [dbStatus, setDbStatus] = _stS("idle"); // idle | checking | ok | error
  const [host, setHost] = _stS("");
  const [panel, setPanel] = _stS("");
  const [pubkey, setPubkey] = _stS("");
  const [saving, setSaving] = _stS(false);
  const toast = useToast();

  // Pull current ServerInfo on mount.
  _stE(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await _stApi("/admin/api/settings/server-info");
        if (cancelled || !info) return;
        setHost(info.server_host || "");
        setPanel(info.panel_url || "");
        setPubkey(info.hbbs_public_key || "");
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await _stApi("/admin/api/settings/server-info", {
        method: "PATCH",
        body: JSON.stringify({
          server_host: host,
          panel_url: panel,
          hbbs_public_key: pubkey,
        }),
      });
      toast("Servidor actualizado", { tone: "success" });
    } catch (err) {
      toast("No se pudo guardar: " + err.message, { tone: "danger" });
    } finally {
      setSaving(false);
    }
  };
  const checkDb = () => {
    // The backend doesn't yet expose a DB connectivity probe, but the
    // app's own /health endpoint going 200 is a good enough proxy.
    setDbStatus("checking");
    fetch("/health")
      .then((r) => setDbStatus(r.ok ? "ok" : "error"))
      .catch(() => setDbStatus("error"));
  };
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Servidor</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>hbbs / hbbr, NAT, STUN/TURN, TLS y backend de datos.</p>
      </div>
      <div style={{ padding: "0 20px" }}>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Host del relay</h3>
            <p>Endpoint que los clientes RustDesk usan para conectarse.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" value={host} onChange={(e) => setHost(e.target.value)} />
            <span className="cm-help">Formato <code>host:puerto</code>. Por defecto el puerto del relay es 21117.</span>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>URL del panel</h3>
            <p>Endpoint público de esta consola.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" value={panel} onChange={(e) => setPanel(e.target.value)} />
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Clave pública HBBS</h3>
            <p>Ed25519 base64. Los clientes la usan para verificar el relay.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" value={pubkey} onChange={(e) => setPubkey(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="cm-btn"><Icon name="copy" size={14} /> Copiar</button>
              <button className="cm-btn"><Icon name="refresh" size={14} /> Rotar par de claves</button>
            </div>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Servidores STUN/TURN</h3>
            <p>Para travesía NAT cuando peer-to-peer no es posible.</p>
          </div>
          <div className="cm-form-row__control">
            <textarea className="cm-textarea" defaultValue={"stun:stun.casaredes.cc:3478\nturn:turn.casaredes.cc:3478?transport=udp"} />
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Certificado TLS</h3>
            <p>Certificado activo para el endpoint público.</p>
          </div>
          <div className="cm-form-row__control">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "var(--bg-subtle)", borderRadius: 8 }}>
              <Icon name="shield" size={18} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>rustdesk.casaredes.cc</div>
                <div style={{ color: "var(--fg-muted)", fontSize: 12 }}>Let's Encrypt · expira en 67 días</div>
              </div>
              <Tag tone="green">Válido</Tag>
            </div>
            <div style={{ display: "flex" }}>
              <button className="cm-btn"><Icon name="upload" size={14} /> Subir nuevo certificado</button>
            </div>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Backend de datos</h3>
            <p>Motor de base de datos y retención de logs.</p>
          </div>
          <div className="cm-form-row__control">
            <div style={{ display: "flex", gap: 8 }}>
              <select className="cm-select" defaultValue="sqlite" style={{ maxWidth: 240 }}>
                <option value="sqlite">SQLite (single-node)</option>
                <option value="postgres">PostgreSQL 14+</option>
                <option value="mysql">MySQL 8+</option>
              </select>
              <select className="cm-select" defaultValue="90" style={{ maxWidth: 220 }}>
                <option>30 días de retención</option>
                <option>60 días de retención</option>
                <option value="90">90 días de retención</option>
                <option>180 días de retención</option>
                <option>1 año de retención</option>
              </select>
              <button
                className="cm-btn"
                onClick={checkDb}
                disabled={dbStatus === "checking"}
                title="Comprobar conexión con la base de datos"
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background:
                      dbStatus === "ok" ? "var(--green-500, #22c55e)" :
                      dbStatus === "error" ? "var(--red-500, #ef4444)" :
                      dbStatus === "checking" ? "var(--amber-500, #f59e0b)" :
                      "var(--zinc-400, #a1a1aa)",
                    boxShadow: dbStatus === "ok" ? "0 0 0 3px rgba(34,197,94,0.18)" :
                               dbStatus === "error" ? "0 0 0 3px rgba(239,68,68,0.18)" :
                               dbStatus === "checking" ? "0 0 0 3px rgba(245,158,11,0.18)" : "none",
                    flexShrink: 0,
                    transition: "background 160ms ease, box-shadow 160ms ease",
                  }}
                />
                {dbStatus === "checking" ? "Comprobando\u2026" : "Comprobar conexi\u00f3n"}
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 0" }}>
          <button
            className="cm-btn cm-btn--primary"
            onClick={save}
            disabled={saving}
          >
            <Icon name={saving ? "refresh" : "check"} size={14} />
            {saving ? "Guardando\u2026" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Seguridad (Tokens API + Política + Sesiones) ────────
function SeguridadPanel() {
  const [sub, setSub] = _stS("tokens");
  const subs = [
    { id: "tokens",   label: "Tokens API" },
    { id: "policy",   label: "Política de acceso" },
    { id: "sessions", label: "Sesiones activas" },
  ];
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Seguridad</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Tokens de API, autenticación de aplicaciones y control de sesiones.</p>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid var(--border)" }}>
        {subs.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            style={{
              padding: "8px 14px",
              borderRadius: "8px 8px 0 0",
              border: "none",
              borderBottom: sub === s.id ? "2px solid var(--primary)" : "2px solid transparent",
              background: "transparent",
              color: sub === s.id ? "var(--primary)" : "var(--fg-muted)",
              fontSize: 13,
              fontWeight: sub === s.id ? 600 : 500,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {sub === "tokens"   && <ApiTokensSection />}
        {sub === "policy"   && <AuthPanel embedded />}
        {sub === "sessions" && <ActiveSessionsSection />}
      </div>
    </div>
  );
}

// ─── Crear nuevo token API ──────────────────────────────────
function CreateTokenModal({ open, onClose, onSubmit }) {
  const operators = ["admin@casaredes.cc", "daniel@casaredes.cc", "soporte@casaredes.cc", "system", "observability", "ci-deploy"];
  const [form, setForm] = _stS({ name: "", user: operators[0], expiry: "365" });
  const [errors, setErrors] = _stS({});
  _stE(() => {
    if (open) { setForm({ name: "", user: operators[0], expiry: "365" }); setErrors({}); }
  }, [open]);
  const submit = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Pon un nombre identificativo";
    else if (form.name.length < 3) errs.name = "Mínimo 3 caracteres";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSubmit({ ...form, name: form.name.trim() });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crear nuevo token API"
      width={520}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button className="cm-btn cm-btn--primary" onClick={submit}>
            <Icon name="key" size={14} /> Generar token
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Cancelar</button>
        </div>
      }
    >
      <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
        Genera un token portador para que aplicaciones externas (CI/CD, monitorización, integraciones) se autentiquen contra la API.
        El secreto solo se mostrará <strong>una vez</strong>.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Nombre <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}>· identifica para qué se usa</span></label>
          <input
            className="cm-input"
            autoFocus
            placeholder="p. ej. grafana-prod, deploy-bot"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {errors.name && <div style={{ color: "var(--rose-600, #e11d48)", fontSize: 12, marginTop: 4 }}>{errors.name}</div>}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Operador asociado <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}>· hereda sus permisos</span></label>
          <select
            className="cm-select"
            value={form.user}
            onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
            style={{ width: "100%" }}
          >
            {operators.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Expiración</label>
          <select
            className="cm-select"
            value={form.expiry}
            onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
            style={{ width: "100%" }}
          >
            <option value="30">30 días</option>
            <option value="90">90 días</option>
            <option value="365">1 año (recomendado)</option>
            <option value="never">Sin caducidad</option>
          </select>
          {form.expiry === "never" && (
            <div style={{ marginTop: 8, padding: 10, background: "color-mix(in oklab, var(--amber-500, #f59e0b) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--amber-500, #f59e0b) 30%, transparent)", borderRadius: 6, fontSize: 12, color: "var(--fg)", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Icon name="alert" size={14} />
              <span>Los tokens permanentes son un riesgo de seguridad. Considera rotar manualmente al menos cada año.</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Mostrar el secreto recién creado (una sola vez) ───────
function NewTokenSecretModal({ open, token, onClose }) {
  const [copied, setCopied] = _stS(false);
  _stE(() => { if (open) setCopied(false); }, [open, token?.secret]);
  if (!token) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(token.secret); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* noop */ }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Token «${token.name}» creado`}
      width={560}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <button className="cm-btn cm-btn--primary" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copiado" : "Copiar token"}
          </button>
          <button className="cm-btn" onClick={onClose} style={{ marginLeft: "auto" }}>Listo, lo he guardado</button>
        </div>
      }
    >
      <div style={{ padding: 14, marginBottom: 16, background: "color-mix(in oklab, var(--amber-500, #f59e0b) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--amber-500, #f59e0b) 35%, transparent)", borderRadius: 8, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Icon name="alert" size={16} />
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Este es el único momento en que verás el secreto completo. Cópialo y guárdalo en tu gestor de secretos antes de cerrar.
        </div>
      </div>
      <label style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 500 }}>Secreto</label>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <input
          readOnly
          value={token.secret}
          onFocus={(e) => e.target.select()}
          style={{
            flex: 1, fontFamily: "var(--font-mono)", fontSize: 13,
            padding: "10px 12px", borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            color: "var(--fg)",
          }}
        />
        <button className="cm-btn" onClick={copy} title="Copiar">
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 12, lineHeight: 1.5 }}>
        Úsalo en cabecera HTTP: <code style={{ background: "var(--bg-subtle)", padding: "2px 6px", borderRadius: 4, fontFamily: "var(--font-mono)" }}>Authorization: Bearer {token.secret.slice(0, 14)}…</code>
      </div>
    </Modal>
  );
}

function ApiTokensSection() {
  const [tokens, setTokens] = _stS([
    { name: "ci-deploy",      prefix: "rdcp_UD1dz6P\u2026", user: "daniel@casaredes",  used: "hace 3 min", exp: "31 dic 2026" },
    { name: "backup-runner",  prefix: "rdcp_kP9aQX2\u2026", user: "system",            used: "hace 1 h",   exp: "sin caducidad" },
    { name: "grafana-scrape", prefix: "rdcp_x7nMt4L\u2026", user: "observability",     used: "hace 12 h",  exp: "15 jun 2026" },
  ]);
  const [revoke, setRevoke] = _stS(null);
  const [createOpen, setCreateOpen] = _stS(false);
  const [createdToken, setCreatedToken] = _stS(null); // { name, secret, prefix }
  const toast = useToast();
  const doRevoke = () => {
    if (!revoke) return;
    const name = revoke.name;
    setTokens((ts) => ts.filter((t) => t.prefix !== revoke.prefix));
    setRevoke(null);
    toast(`Token «${name}» revocado`, { tone: "success" });
  };
  const handleCreate = (form) => {
    // generar secreto pseudo-aleatorio (mock)
    const rand = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const secret = "rdcp_" + (rand() + rand()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 36);
    const prefix = secret.slice(0, 12) + "\u2026";
    const expLabel =
      form.expiry === "never" ? "sin caducidad" :
      form.expiry === "30"    ? new Date(Date.now() + 30 * 86400000).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) :
      form.expiry === "90"    ? new Date(Date.now() + 90 * 86400000).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) :
      form.expiry === "365"   ? new Date(Date.now() + 365 * 86400000).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    setTokens((ts) => [
      { name: form.name, prefix, user: form.user, used: "—", exp: expLabel },
      ...ts,
    ]);
    setCreateOpen(false);
    setCreatedToken({ name: form.name, secret, prefix });
  };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 16 }}>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: 0, maxWidth: 560 }}>
          Tokens portadores (<code>Authorization: Bearer rdcp_…</code>) usados por integraciones server-to-server. El secreto solo se muestra al crearlo.
        </p>
        <button className="cm-btn cm-btn--primary" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} /> Nuevo token
        </button>
      </div>
      <table className="cm-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Prefijo</th>
            <th>Operador</th>
            <th>Último uso</th>
            <th>Caduca</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.prefix}>
              <td style={{ fontWeight: 500 }}>{t.name}</td>
              <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{t.prefix}</code></td>
              <td>{t.user}</td>
              <td style={{ color: "var(--fg-muted)" }}>{t.used}</td>
              <td style={{ color: "var(--fg-muted)" }}>{t.exp}</td>
              <td style={{ textAlign: "right" }}>
                <button
                  className="cm-btn cm-btn--ghost"
                  title="Revocar"
                  onClick={() => setRevoke(t)}
                ><Icon name="trash" size={14} /></button>
              </td>
            </tr>
          ))}
          {tokens.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--fg-muted)", padding: 32 }}>
              No hay tokens activos.
            </td></tr>
          )}
        </tbody>
      </table>

      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        onConfirm={doRevoke}
        title={`Revocar token «${revoke?.name || ""}»`}
        description={`El token «${revoke?.name}» (${revoke?.prefix}) dejará de funcionar inmediatamente. Las integraciones que lo usan empezarán a recibir 401 Unauthorized.`}
        confirmLabel="Revocar token"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={revoke?.name}
      />

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      <NewTokenSecretModal
        open={!!createdToken}
        token={createdToken}
        onClose={() => setCreatedToken(null)}
      />
    </>
  );
}

function ActiveSessionsSection() {
  const sessions = [
    { who: "admin@casaredes",   ip: "83.45.12.7",    ua: "Chrome 130 / macOS",    started: "hoy, 09:14",  current: true },
    { who: "daniel@casaredes",  ip: "83.45.12.140",  ua: "Firefox 132 / Windows", started: "hoy, 08:02",  current: false },
    { who: "ci-deploy (token)", ip: "10.0.4.18",     ua: "curl/8.4 (CI runner)",  started: "ayer, 22:40", current: false },
  ];
  return (
    <>
      <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "0 0 16px" }}>
        Sesiones de la consola actualmente abiertas. Puedes cerrar cualquiera salvo la actual.
      </p>
      <table className="cm-table" style={{ width: "100%" }}>
        <thead><tr><th>Operador</th><th>IP</th><th>Navegador</th><th>Iniciada</th><th></th></tr></thead>
        <tbody>
          {sessions.map((s, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500 }}>{s.who} {s.current && <Tag tone="blue" style={{ marginLeft: 8 }}>actual</Tag>}</td>
              <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{s.ip}</code></td>
              <td style={{ color: "var(--fg-muted)" }}>{s.ua}</td>
              <td style={{ color: "var(--fg-muted)" }}>{s.started}</td>
              <td style={{ textAlign: "right" }}>
                <button className="cm-btn cm-btn--ghost" disabled={s.current}>
                  <Icon name="x" size={14} /> Cerrar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ─── Auth (ahora usado dentro de Seguridad → Política) ────
function AuthPanel({ embedded = false } = {}) {
  const [providers, setProviders] = _stS({ ldap: true, oidc: false, saml: false, mfa: true });
  const rows = (
    <div style={{ padding: embedded ? 0 : "0 20px" }}>
      {[
        { id: "ldap", title: "LDAP / Active Directory", desc: "Autenticación contra un directorio LDAP existente." },
        { id: "oidc", title: "OpenID Connect (OIDC)",   desc: "Google, Microsoft, Okta, Authentik, Keycloak…" },
        { id: "saml", title: "SAML 2.0",                desc: "SSO empresarial con metadata IdP." },
        { id: "mfa",  title: "Forzar MFA",              desc: "Todos los usuarios deben configurar TOTP o WebAuthn." },
      ].map((p) => (
        <div key={p.id} className="cm-form-row" style={{ alignItems: "center" }}>
          <div className="cm-form-row__label">
            <h3>{p.title}</h3>
            <p>{p.desc}</p>
          </div>
          <div className="cm-form-row__control" style={{ alignItems: "flex-start" }}>
            <Switch checked={providers[p.id]} onChange={(v) => setProviders((s) => ({ ...s, [p.id]: v }))} />
            {providers[p.id] && p.id !== "mfa" && (
              <button className="cm-btn cm-btn--ghost" style={{ alignSelf: "flex-start", marginTop: 4 }}>
                <Icon name="edit" size={14} /> Configurar
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
  if (embedded) return rows;
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Política de acceso</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Proveedores de identidad y políticas de acceso.</p>
      </div>
      {rows}
    </div>
  );
}

// ─── Network ─────────────────────────────────────────
function NetworkPanel() {
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Network</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Puertos, NAT, STUN/TURN y certificados TLS.</p>
      </div>
      <div style={{ padding: "0 20px" }}>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Puerto del relay</h3>
            <p>Puerto TCP/UDP escuchado por el servicio.</p>
          </div>
          <div className="cm-form-row__control">
            <input className="cm-input" defaultValue="21117" style={{ maxWidth: 160 }} />
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Servidores STUN/TURN</h3>
            <p>Para travesía NAT cuando peer-to-peer no es posible.</p>
          </div>
          <div className="cm-form-row__control">
            <textarea className="cm-textarea" defaultValue={"stun:stun.acme.io:3478\nturn:turn.acme.io:3478?transport=udp"} />
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Certificado TLS</h3>
            <p>Certificado activo para el endpoint público.</p>
          </div>
          <div className="cm-form-row__control">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "var(--bg-subtle)", borderRadius: 8 }}>
              <Icon name="shield" size={18} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>relay.acme.io</div>
                <div style={{ color: "var(--fg-muted)", fontSize: 12 }}>Let's Encrypt · expira en 67 días</div>
              </div>
              <Tag tone="green">Válido</Tag>
            </div>
            <div style={{ display: "flex" }}>
              <button className="cm-btn"><Icon name="upload" size={14} /> Subir nuevo certificado</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Storage ─────────────────────────────────────────
function StoragePanel() {
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Storage / Database</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Persistencia, retención y backups.</p>
      </div>
      <div style={{ padding: "0 20px" }}>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Backend</h3>
            <p>Motor de base de datos.</p>
          </div>
          <div className="cm-form-row__control">
            <select className="cm-select" defaultValue="sqlite" style={{ maxWidth: 240 }}>
              <option value="sqlite">SQLite (single-node)</option>
              <option value="postgres">PostgreSQL 14+</option>
              <option value="mysql">MySQL 8+</option>
            </select>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Retención de logs</h3>
            <p>Cuánto tiempo se conservan eventos de conexión.</p>
          </div>
          <div className="cm-form-row__control">
            <select className="cm-select" defaultValue="90" style={{ maxWidth: 200 }}>
              <option>30 días</option>
              <option>60 días</option>
              <option value="90">90 días</option>
              <option>180 días</option>
              <option>1 año</option>
            </select>
          </div>
        </div>
        <div className="cm-form-row">
          <div className="cm-form-row__label">
            <h3>Backups automáticos</h3>
            <p>Snapshot diario en almacenamiento S3-compatible.</p>
          </div>
          <div className="cm-form-row__control">
            <Switch checked={true} onChange={() => {}} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Updates ─────────────────────────────────────────
function UpdatesPanel() {
  const [status, setStatus] = _stS("uptodate"); // checking | uptodate | available | error
  const [lastChecked, setLastChecked] = _stS("hace 2 h");
  const toast = useToast();
  const checkNow = () => {
    setStatus("checking");
    setTimeout(() => {
      // mock: 70% al día, 25% hay update, 5% error
      const r = Math.random();
      if (r < 0.7) { setStatus("uptodate"); setLastChecked("ahora mismo"); toast("No hay actualizaciones disponibles", { tone: "success" }); }
      else if (r < 0.95) { setStatus("available"); setLastChecked("ahora mismo"); toast("Hay una nueva versión disponible: v2.5.0"); }
      else { setStatus("error"); toast("No se pudo contactar con el repositorio", { tone: "error" }); }
    }, 1100);
  };
  const isChecking = status === "checking";
  const statusTag =
    status === "checking" ? <Tag tone="default">Comprobando…</Tag> :
    status === "available" ? <Tag tone="primary"><Icon name="alert" size={12} /> v2.5.0 disponible</Tag> :
    status === "error" ? <Tag tone="rose"><Icon name="x" size={12} /> Error</Tag> :
    <Tag tone="green"><Icon name="check" size={12} /> Al día</Tag>;
  return (
    <div className="cm-card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Updates &amp; About</h2>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>Versión instalada, canal y notas de cambios.</p>
      </div>
      <div style={{ padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 20, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-subtle)" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, var(--blue-500), var(--blue-700))", display: "grid", placeItems: "center", color: "#fff", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>RD</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600 }}>rd-console v2.4.1</div>
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Build 8821 · canal stable · MIT</div>
            <div style={{ color: "var(--fg-muted)", fontSize: 11, marginTop: 4 }}>Última comprobación: {lastChecked} · origen: <code style={{ fontFamily: "var(--font-mono)" }}>github.com/rustdesk/rustdesk</code></div>
          </div>
          {statusTag}
          <button
            className="cm-btn"
            onClick={checkNow}
            disabled={isChecking}
            title="Comprobar si hay nuevas versiones en el repositorio configurado"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span style={{
              display: "inline-flex",
              animation: isChecking ? "rd-spin 0.9s linear infinite" : "none",
            }}>
              <Icon name="refresh" size={14} />
            </span>
            {isChecking ? "Comprobando…" : "Comprobar actualizaciones"}
          </button>
        </div>
        {status === "available" && (
          <div style={{ marginTop: 12, padding: 14, border: "1px solid color-mix(in oklab, var(--primary) 35%, var(--border))", background: "color-mix(in oklab, var(--primary) 5%, transparent)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="download" size={16} />
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
              <strong>v2.5.0</strong> está disponible — incluye reescritura del File Transfer y permisos por grupo refinados.
            </div>
            <button className="cm-btn cm-btn--primary" onClick={() => toast("Descargando actualización…")}><Icon name="download" size={14} /> Instalar</button>
          </div>
        )}
        <style>{`
          @keyframes rd-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
        `}</style>
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", margin: "0 0 12px" }}>Cambios recientes</h3>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { v: "v2.4.1", d: "Hace 3 días",  notes: "Fix: drawer de devices se quedaba abierto al cambiar de página." },
              { v: "v2.4.0", d: "Hace 2 sem",   notes: "Nueva sección Address Book + permisos por grupo." },
              { v: "v2.3.5", d: "Hace 1 mes",   notes: "Soporte de SAML 2.0 y exportación CSV de logs." },
            ].map((c) => (
              <li key={c.v} style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <code style={{ fontFamily: "var(--font-mono)", color: "var(--primary)", minWidth: 64 }}>{c.v}</code>
                <span style={{ color: "var(--fg-muted)", minWidth: 90 }}>{c.d}</span>
                <span>{c.notes}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Roles & permisos ────────────────────────────────
const _ROLE_PERMS = [
  { area: "Dispositivos", perms: [
    { id: "devices.read",    label: "Ver dispositivos" },
    { id: "devices.edit",    label: "Editar alias / tags / notas" },
    { id: "devices.delete",  label: "Eliminar dispositivos" },
    { id: "devices.kick",    label: "Forzar reconexión / kick" },
  ]},
  { area: "Usuarios", perms: [
    { id: "users.read",      label: "Ver lista de operadores" },
    { id: "users.invite",    label: "Invitar nuevos operadores" },
    { id: "users.edit",      label: "Editar operadores" },
    { id: "users.delete",    label: "Eliminar operadores" },
  ]},
  { area: "Invitaciones (tokens)", perms: [
    { id: "tokens.read",     label: "Ver invitaciones" },
    { id: "tokens.create",   label: "Crear invitaciones" },
    { id: "tokens.revoke",   label: "Revocar / eliminar" },
  ]},
  { area: "Auditoría", perms: [
    { id: "logs.read",       label: "Leer logs" },
    { id: "logs.export",     label: "Exportar / vaciar" },
  ]},
  { area: "Sistema", perms: [
    { id: "settings.read",   label: "Ver ajustes" },
    { id: "settings.write",  label: "Modificar ajustes del relay" },
    { id: "roles.manage",    label: "Gestionar roles" },
  ]},
];

const _ROLES_INIT = [
  {
    id: "admin", name: "Administrador", builtin: true,
    description: "Acceso total al relay, usuarios y configuración.",
    perms: new Set([
      "devices.read","devices.edit","devices.delete","devices.kick",
      "users.read","users.invite","users.edit","users.delete",
      "tokens.read","tokens.create","tokens.revoke",
      "logs.read","logs.export",
      "settings.read","settings.write","roles.manage",
    ]),
    members: 2,
  },
  {
    id: "operator", name: "Operador", builtin: true,
    description: "Día a día — gestiona dispositivos e invitaciones, sin tocar configuración.",
    perms: new Set([
      "devices.read","devices.edit","devices.kick",
      "tokens.read","tokens.create","tokens.revoke",
      "logs.read",
    ]),
    members: 5,
  },
  {
    id: "viewer", name: "Lector", builtin: true,
    description: "Solo lectura — útil para auditoría externa o NOC.",
    perms: new Set([
      "devices.read","users.read","tokens.read","logs.read","settings.read",
    ]),
    members: 1,
  },
];

function RolesPanel() {
  const [roles, setRoles] = _stS(_ROLES_INIT);
  const [selectedId, setSelectedId] = _stS(_ROLES_INIT[0].id);
  const [editing, setEditing] = _stS(false);
  const [draft, setDraft] = _stS(null);
  const [deleteRole, setDeleteRole] = _stS(null);
  const toast = useToast();

  const role = roles.find((r) => r.id === selectedId) || roles[0];

  const startEdit = () => {
    setDraft({ ...role, perms: new Set(role.perms) });
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDraft(null); };
  const saveEdit = () => {
    setRoles((rs) => rs.map((r) => r.id === draft.id ? draft : r));
    setEditing(false);
    setDraft(null);
    toast("Rol actualizado", { tone: "success" });
  };
  const togglePerm = (id) => {
    setDraft((d) => {
      const ps = new Set(d.perms);
      if (ps.has(id)) ps.delete(id); else ps.add(id);
      return { ...d, perms: ps };
    });
  };
  const duplicateRole = () => {
    const id = "rol_" + Math.random().toString(36).slice(2, 7);
    const copy = {
      ...role, id, name: `${role.name} (copia)`,
      builtin: false, members: 0, perms: new Set(role.perms),
    };
    setRoles((rs) => [...rs, copy]);
    setSelectedId(id);
    setDraft(copy);
    setEditing(true);
    toast("Rol duplicado para edición");
  };
  const removeRole = () => {
    if (!deleteRole) return;
    const removedId = deleteRole.id;
    const removedName = deleteRole.name;
    setRoles((rs) => {
      const next = rs.filter((r) => r.id !== removedId);
      // si borramos el seleccionado, saltar al primero que quede
      if (selectedId === removedId) {
        setSelectedId(next[0]?.id);
      }
      return next;
    });
    setEditing(false);
    setDraft(null);
    setDeleteRole(null);
    toast(`Rol «${removedName}» eliminado`, { tone: "success" });
  };

  const view = editing ? draft : role;

  return (
    <div className="cm-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0 }}>Roles & permisos</h2>
          <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>
            Define qué puede hacer cada operador. Los roles built-in no se pueden editar — duplícalos para crear los tuyos.
          </p>
        </div>
        <button
          className="cm-btn cm-btn--primary"
          onClick={() => {
            const id = "rol_" + Math.random().toString(36).slice(2, 7);
            const r = { id, name: "Nuevo rol", description: "", builtin: false, members: 0, perms: new Set() };
            setRoles((rs) => [...rs, r]);
            setSelectedId(id);
            setDraft(r);
            setEditing(true);
          }}
        >
          <Icon name="plus" size={14} /> Crear rol
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 400 }}>
        {/* Lista de roles */}
        <aside style={{ borderRight: "1px solid var(--border)", padding: 8, maxHeight: 600, overflowY: "auto" }}>
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => { if (!editing) setSelectedId(r.id); }}
              disabled={editing && r.id !== view?.id}
              style={{
                width: "100%", textAlign: "left",
                display: "flex", flexDirection: "column", gap: 2,
                padding: "10px 12px", borderRadius: 8,
                border: 0, cursor: editing && r.id !== view?.id ? "not-allowed" : "pointer",
                background: selectedId === r.id ? "var(--bg-subtle)" : "transparent",
                color: "var(--fg)", fontFamily: "inherit",
                opacity: editing && r.id !== view?.id ? 0.4 : 1,
                marginBottom: 2,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 500 }}>
                {r.name}
                {r.builtin && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    sistema
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                {r.members} {r.members === 1 ? "miembro" : "miembros"} · {r.perms.size} permisos
              </div>
            </button>
          ))}
        </aside>

        {/* Detalle */}
        <div style={{ padding: 20 }}>
          {/* Cabecera con metadata */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              {editing ? (
                <>
                  <input
                    className="cm-input"
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, marginBottom: 6 }}
                  />
                  <textarea
                    className="cm-textarea"
                    rows={2}
                    placeholder="Descripción opcional para que otros admins entiendan el alcance del rol."
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                </>
              ) : (
                <>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    {view?.name}
                    {view?.builtin && (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, background: "var(--bg-subtle)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 500 }}>
                        sistema
                      </span>
                    )}
                  </h3>
                  <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: "4px 0 0" }}>
                    {view?.description || <em>Sin descripción.</em>}
                  </p>
                </>
              )}
            </div>
            {!editing && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="cm-btn" onClick={duplicateRole} title="Crear copia editable">
                  <Icon name="copy" size={14} /> Duplicar
                </button>
                <button
                  className="cm-btn"
                  onClick={startEdit}
                  disabled={view?.builtin}
                  title={view?.builtin ? "Los roles del sistema no se pueden modificar. Duplícalo para crear una versión editable." : "Editar este rol"}
                >
                  <Icon name="edit" size={14} /> Editar
                </button>
                <button
                  className="cm-btn"
                  onClick={() => setDeleteRole(view)}
                  disabled={view?.builtin}
                  title={view?.builtin ? "Los roles del sistema no se pueden eliminar." : "Eliminar este rol"}
                  style={!view?.builtin ? { color: "#e11d48", borderColor: "color-mix(in oklab, #e11d48 40%, var(--border))" } : undefined}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Grid permisos */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {_ROLE_PERMS.map((area) => (
              <div key={area.area}>
                <div style={{ fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600, marginBottom: 8 }}>
                  {area.area}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                  {area.perms.map((p) => {
                    const checked = view?.perms.has(p.id);
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 10px", borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: checked ? "color-mix(in oklab, var(--primary) 6%, transparent)" : "transparent",
                          cursor: editing ? "pointer" : "default",
                          fontSize: 13,
                          opacity: editing ? 1 : 0.95,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!editing}
                          onChange={() => togglePerm(p.id)}
                        />
                        <span style={{ flex: 1 }}>{p.label}</span>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{p.id}</code>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer edit */}
          {editing && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <button className="cm-btn cm-btn--primary" onClick={saveEdit}>
                <Icon name="check" size={14} /> Guardar cambios
              </button>
              <button className="cm-btn" onClick={cancelEdit}>Cancelar</button>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "var(--fg-muted)", alignSelf: "center" }}>
                {draft?.perms.size} permisos seleccionados
              </span>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteRole}
        onClose={() => setDeleteRole(null)}
        onConfirm={removeRole}
        title={`Eliminar rol «${deleteRole?.name || ""}»`}
        description={`Vas a eliminar el rol «${deleteRole?.name}». Los ${deleteRole?.members || 0} operadores que lo tenían asignado pasarán al rol Lector por defecto.`}
        confirmLabel="Eliminar rol"
        cancelLabel="Cancelar"
        tone="danger"
        typeToConfirm={deleteRole?.name}
      />
    </div>
  );
}

// ─── Settings shell ───────────────────────────────────────
function SettingsPage({ route, navigate, theme, setTheme }) {
  const sub = (route.split("/")[2] || "general");
  return (
    <div className="cm-page">
      <PageHeader
        title="Ajustes"
        subtitle="Configuración del relay, operadores y seguridad."
      />
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, alignItems: "flex-start" }}>
        <SettingsNav active={sub} onNav={navigate} />
        <div>
          {sub === "general"   && <GeneralPanel theme={theme} setTheme={setTheme} />}
          {sub === "servidor"  && <ServidorPanel />}
          {sub === "usuarios"  && window.UsersPage && <window.UsersPage embedded={true} />}
          {sub === "roles"     && <RolesPanel />}
          {sub === "seguridad" && <SeguridadPanel />}
          {sub === "updates"   && <UpdatesPanel />}
        </div>
      </div>
    </div>
  );
}

window.SettingsPage = SettingsPage;
window.RD_AVAILABLE_ROLES = _ROLES_INIT.map((r) => ({ id: r.id, name: r.name, description: r.description, builtin: r.builtin }));
