// Pages — Login (standalone, full-bleed)
//
// Cableado al backend (Etapa 3 paso 1):
// - El form de login envía {username, password} a POST /api/auth/login.
//   El backend acepta el value como email (si contiene "@") o como
//   username plano. La respuesta {access_token} se guarda en
//   localStorage("cm-auth") como {token, savedAt}.
// - El form de "olvidada" sigue siendo cosmético hasta que exista
//   POST /auth/forgot en el backend (BACKEND.md §1).
//
// PR 1 de la migración Etapa 4: ESM puro, exporta `LoginPage`. Se
// elimina `window.LoginPage` global; los consumidores importan la
// función directamente.

import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";

interface LoginPageProps {
  navigate: (path: string) => void;
}

type Stage = "login" | "forgot";

export function LoginPage({ navigate }: LoginPageProps) {
  const [stage, setStage] = useState<Stage>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Email o contraseña incorrectos.");
        } else if (res.status === 429) {
          setError("Demasiados intentos. Espera un minuto e inténtalo de nuevo.");
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.detail || `Error ${res.status} al iniciar sesión.`);
        }
        return;
      }
      const data = await res.json();
      localStorage.setItem(
        "cm-auth",
        JSON.stringify({ token: data.access_token, savedAt: Date.now() }),
      );
      navigate("/dashboard");
    } catch {
      setError("No se pudo conectar al servidor.");
    } finally {
      setSubmitting(false);
    }
  };

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
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>Email o usuario</span>
              <input
                className="cm-input"
                type="text"
                placeholder="admin"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </label>
            <label>
              <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>
                <span>Contraseña</span>
                <a href="#" onClick={(e) => { e.preventDefault(); setStage("forgot"); }} style={{ color: "var(--primary)" }}>¿Olvidada?</a>
              </span>
              <input
                className="cm-input"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" defaultChecked disabled={submitting} /> Mantener sesión iniciada
            </label>
            {error && (
              <div role="alert" style={{ color: "#e11d48", fontSize: 13, lineHeight: 1.4, padding: "8px 10px", background: "rgba(225,29,72,.08)", border: "1px solid rgba(225,29,72,.25)", borderRadius: 8 }}>
                {error}
              </div>
            )}
            <button className="cm-btn cm-btn--primary" type="submit" style={{ marginTop: 4, justifyContent: "center" }} disabled={submitting}>
              {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-muted)", fontSize: 12, margin: "8px 0" }}>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span>o</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
            <button type="button" className="cm-btn" style={{ justifyContent: "center" }} disabled><Icon name="shield" size={14} /> Continuar con SSO</button>
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
