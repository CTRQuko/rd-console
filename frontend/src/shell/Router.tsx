// Route → page resolver. Each branch will gain a real <Page/> as PR
// 3 + PR 4 of the Etapa 4 migration land. Until then, anything that
// isn't yet migrated routes through <NotMigrated/> so the operator gets
// a useful "this lives in the legacy tree" message.
import type { Dispatch, SetStateAction } from "react";
import type { ThemeState } from "./theme";
import { LoginPage } from "../pages/Login";
import { DashboardPage } from "../pages/Dashboard";
import { DevicesPage } from "../pages/Devices";
import { UsersPage } from "../pages/Users";

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
        el árbol Babel runtime. PR 4 (Logs / JoinTokens / AddressBook /
        Settings) la migrará a ESM.
      </p>
    </div>
  );
}

export function Router(props: RouterProps) {
  const { route, navigate } = props;
  if (route === "/" || route === "/dashboard")
    return <DashboardPage navigate={navigate} />;
  if (route.startsWith("/devices"))
    return <DevicesPage route={route} navigate={navigate} />;
  if (route.startsWith("/users"))
    return <UsersPage route={route} navigate={navigate} />;
  if (route.startsWith("/addressbook")) return <NotMigrated route={route} />;
  if (route.startsWith("/tokens"))      return <NotMigrated route={route} />;
  if (route.startsWith("/logs"))        return <NotMigrated route={route} />;
  if (route.startsWith("/settings"))    return <NotMigrated route={route} />;
  if (route.startsWith("/login"))       return <LoginPage navigate={navigate} />;
  return <NotMigrated route={route} />;
}
