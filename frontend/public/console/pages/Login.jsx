// ============================================================
// Pages — Login (standalone, full-bleed)
// ============================================================

const { useState: _liS } = React;

function LoginPage({ navigate }) {
  const [stage, setStage] = _liS("login"); // 'login' | 'forgot'
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)" }}>
      <div className="cm-card" style={{ width: 380, padding: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg, var(--blue-500), var(--blue-700))", display: "grid", placeItems: "center", color: "#fff", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, marginBottom: 12 }}>RD</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>
            {stage === "login" ? "rd-console" : "Recuperar contraseña"}
          </h1>
          <p style={{ color: "var(--fg-muted)", fontSize: 13, margin: 0, textAlign: "center" }}>
            {stage === "login" ? "Inicia sesión en tu relay" : "Te enviaremos un enlace de recuperación."}
          </p>
        </div>

        {stage === "login" ? (
          <form onSubmit={(e) => { e.preventDefault(); navigate("/dashboard"); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>Email</span>
              <input className="cm-input" type="email" placeholder="alex@acme.io" required defaultValue="alex@acme.io" />
            </label>
            <label>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>
                <span>Contraseña</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setStage("forgot"); }} style={{ color: "var(--primary)" }}>¿Olvidada?</a>
              </span>
              <input className="cm-input" type="password" placeholder="••••••••" required defaultValue="demopassword" />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" defaultChecked /> Mantener sesión iniciada
            </label>
            <button className="cm-btn cm-btn--primary" type="submit" style={{ marginTop: 4, justifyContent: "center" }}>
              Iniciar sesión
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-muted)", fontSize: 12, margin: "8px 0" }}>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span>o</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <button type="button" className="cm-btn" style={{ justifyContent: "center" }}><Icon name="shield" size={14} /> Continuar con SSO</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setStage("login"); }} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>Email</span>
              <input className="cm-input" type="email" placeholder="alex@acme.io" required />
            </label>
            <button className="cm-btn cm-btn--primary" type="submit" style={{ justifyContent: "center" }}>Enviar enlace</button>
            <button type="button" className="cm-btn cm-btn--ghost" onClick={() => setStage("login")} style={{ justifyContent: "center" }}>
              <Icon name="chevronLeft" size={14} /> Volver
            </button>
          </form>
        )}
      </div>
      <p style={{ color: "var(--fg-muted)", fontSize: 12, marginTop: 16, textAlign: "center" }}>
        rd-console v2.4.1 ·{" "}
        <a href="#/dashboard" onClick={(e) => { e.preventDefault(); navigate("/dashboard"); }} style={{ color: "var(--primary)" }}>
          Saltar al dashboard (demo)
        </a>
      </p>
    </div>
  );
}

window.LoginPage = LoginPage;
