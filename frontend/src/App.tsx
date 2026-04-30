// Root component for the ESM build (Etapa 4, PR 1).
//
// Hash-based routing identical to the legacy shell — `#/<path>` drives
// what's rendered. PR 1 only ships the Login page; everything else
// shows a placeholder so it's obvious which routes haven't been
// migrated yet. PR 2 will replace this stub with the real <Layout> +
// <Router> from the legacy shell.jsx, also in ESM.

import { useState, useEffect, useCallback } from "react";
import { LoginPage } from "./pages/Login";

function readRoute(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h || "/login";
}

export function App() {
  const [route, setRoute] = useState<string>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((path: string) => {
    window.location.hash = path.startsWith("/") ? path : `/${path}`;
  }, []);

  if (route === "/login" || route === "/" || route === "") {
    return <LoginPage navigate={navigate} />;
  }

  // PR 1 stub: any other route shows a placeholder. The legacy chrome
  // (sidebar/topbar) hasn't been migrated yet — that's PR 2.
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg)", color: "var(--fg)", fontFamily: "var(--font-sans)" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
          Página no migrada todavía
        </div>
        <p style={{ color: "var(--fg-muted)", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          La ruta <code style={{ fontFamily: "var(--font-mono)" }}>{route}</code> aún vive en
          el árbol Babel runtime. PR 2-5 migran el resto del shell + páginas a ESM.
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="#/login" onClick={(e) => { e.preventDefault(); navigate("/login"); }} style={{ color: "var(--primary)", fontSize: 13 }}>
            ← Volver a Login
          </a>
        </p>
      </div>
    </div>
  );
}
