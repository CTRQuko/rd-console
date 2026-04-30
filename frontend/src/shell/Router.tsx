// Route → page resolver. Each branch will gain a real <Page/> as PR
// 3 + PR 4 of the Etapa 4 migration land. Until then, anything that
// isn't /login routes through <NotMigrated/> so the operator gets a
// useful "this lives in the legacy tree" message instead of a blank
// screen.
import type { Dispatch, SetStateAction } from "react";
import type { ThemeState } from "./theme";
import { LoginPage } from "../pages/Login";

interface RouterProps {
  route: string;
  navigate: (path: string) => void;
  theme: ThemeState;
  setTheme: Dispatch<SetStateAction<ThemeState>>;
}

function NotMigrated({ route }: { route: string }) {
  return (
    <div className="cm-page" style={{ padding: 40, textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Página pendiente de migración
      </h1>
      <p style={{ color: "var(--fg-muted)", fontSize: 14, lineHeight: 1.5, maxWidth: 520, margin: "0 auto" }}>
        La ruta <code style={{ fontFamily: "var(--font-mono)" }}>{route}</code> aún vive en
        el árbol Babel runtime. PR 3 (Dashboard / Devices / Users) y PR 4
        (Logs / JoinTokens / AddressBook / Settings) la migrarán a ESM.
      </p>
    </div>
  );
}

export function Router(props: RouterProps) {
  const { route, navigate } = props;
  if (route === "/" || route === "/dashboard") return <NotMigrated route={route} />;
  if (route.startsWith("/devices"))     return <NotMigrated route={route} />;
  if (route.startsWith("/addressbook")) return <NotMigrated route={route} />;
  if (route.startsWith("/tokens"))      return <NotMigrated route={route} />;
  if (route.startsWith("/logs"))        return <NotMigrated route={route} />;
  if (route.startsWith("/users"))       return <NotMigrated route={route} />;
  if (route.startsWith("/settings"))    return <NotMigrated route={route} />;
  if (route.startsWith("/login"))       return <LoginPage navigate={navigate} />;
  return <NotMigrated route={route} />;
}
