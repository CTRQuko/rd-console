// Shell host: brings together Sidebar + Topbar + CommandPalette and
// hands the active page <Router /> the runtime props (route, navigate,
// theme, setTheme). Owns the auth gate that bounces unauthenticated
// users to /login and authenticated users away from it.
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { findActive, makeCrumbs } from "./nav";
import { readAuthToken } from "./auth";
import { useThemeState } from "./theme";
import { Router } from "./Router";

function readRoute(): string {
  return window.location.hash.replace(/^#/, "") || "/dashboard";
}

export function Layout() {
  const [route, setRoute] = useState<string>(readRoute);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((to: string) => {
    window.location.hash = to.startsWith("/") ? to : `/${to}`;
  }, []);

  const active = findActive(route);
  const crumbs = makeCrumbs(route);

  const [theme, setTheme] = useThemeState();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("cm-side-collapsed") === "1",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Auth gate.
  useEffect(() => {
    const hasToken = !!readAuthToken();
    const onLogin = route === "/login" || route.startsWith("/login");
    if (!hasToken && !onLogin) {
      navigate("/login");
    } else if (hasToken && onLogin) {
      navigate("/dashboard");
    }
  }, [route, navigate]);

  useEffect(() => {
    localStorage.setItem("cm-side-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Login is full-bleed: render Router directly without sidebar/topbar.
  if (route === "/login" || route.startsWith("/login")) {
    return <Router route={route} navigate={navigate} theme={theme} setTheme={setTheme} />;
  }

  const sideMode = mobileOpen ? "open" : collapsed ? "collapsed" : "default";

  return (
    <div className="cm-app" data-side={sideMode}>
      <Sidebar
        active={active}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onNav={(p) => {
          navigate(p);
          setMobileOpen(false);
        }}
      />
      <Topbar
        crumbs={crumbs}
        theme={theme}
        setTheme={setTheme}
        onOpenPalette={() => setPaletteOpen(true)}
        onMobileMenu={() => setMobileOpen((o) => !o)}
        onNav={navigate}
      />
      <main className="cm-main">
        <Router route={route} navigate={navigate} theme={theme} setTheme={setTheme} />
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNav={navigate}
      />
    </div>
  );
}
