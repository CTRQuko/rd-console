// Route → page resolver. Etapa 4 PR 4 — every page now lives in src/.
import type { Dispatch, SetStateAction } from "react";
import type { ThemeState } from "./theme";
import { LoginPage } from "../pages/Login";
import { DashboardPage } from "../pages/Dashboard";
import { DevicesPage } from "../pages/Devices";
import { UsersPage } from "../pages/Users";
import { LogsPage } from "../pages/Logs";
import { JoinTokensPage } from "../pages/JoinTokens";
import { AddressBookPage } from "../pages/AddressBook";
import { SettingsPage } from "../pages/Settings";

interface RouterProps {
  route: string;
  navigate: (path: string) => void;
  theme: ThemeState;
  setTheme: Dispatch<SetStateAction<ThemeState>>;
}

export function Router(props: RouterProps) {
  const { route, navigate, theme, setTheme } = props;
  if (route === "/" || route === "/dashboard")
    return <DashboardPage navigate={navigate} />;
  if (route.startsWith("/devices"))
    return <DevicesPage route={route} navigate={navigate} />;
  if (route.startsWith("/users"))
    return <UsersPage route={route} navigate={navigate} />;
  if (route.startsWith("/addressbook"))
    return <AddressBookPage route={route} navigate={navigate} />;
  if (route.startsWith("/tokens"))
    return <JoinTokensPage route={route} navigate={navigate} />;
  if (route.startsWith("/logs"))
    return <LogsPage route={route} navigate={navigate} />;
  if (route.startsWith("/settings"))
    return <SettingsPage route={route} navigate={navigate} theme={theme} setTheme={setTheme} />;
  if (route.startsWith("/login"))
    return <LoginPage navigate={navigate} />;
  return (
    <div className="cm-page" style={{ padding: 40, textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Página no encontrada
      </h1>
      <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>
        Ruta: <code style={{ fontFamily: "var(--font-mono)" }}>{route}</code>
      </p>
    </div>
  );
}
