// Sidebar — left-side navigation rail with brand, grouped links, and a
// collapse toggle. Polls /admin/api/devices every 60 s to keep the
// "Dispositivos" badge accurate without staring at a stale "248" ghost.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { NAV, type NavItem } from "./nav";
import { readAuthToken } from "./auth";

interface SidebarProps {
  active: { id: string };
  collapsed: boolean;
  onToggle: () => void;
  onNav: (path: string) => void;
}

export function Sidebar({ active, collapsed, onToggle, onNav }: SidebarProps) {
  const [badges, setBadges] = useState<Record<string, string>>({});
  useEffect(() => {
    const token = readAuthToken();
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/admin/api/devices", {
          headers: { Authorization: "Bearer " + token },
        });
        if (!r.ok || cancelled) return;
        const list = (await r.json()) as unknown[];
        if (!cancelled) setBadges((b) => ({ ...b, devices: String(list.length) }));
      } catch {
        // silent — empty badge on error
      }
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return (
    <aside className="cm-side" aria-label="Navegación principal">
      <div className="cm-side__brand">
        <div className="cm-side__logo">RD</div>
        <span className="cm-side__name">rd-console</span>
      </div>
      <nav className="cm-side__nav">
        {NAV.map((group) => (
          <div key={group.group}>
            <div className="cm-side__group">{group.group}</div>
            {group.items.map((it: NavItem) => {
              const badge = badges[it.id] ?? it.badge;
              return (
                <a
                  key={it.id}
                  href={"#" + it.path}
                  className="cm-side__item"
                  aria-current={active.id === it.id ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onNav(it.path);
                  }}
                  title={collapsed ? it.label : undefined}
                >
                  <span className="cm-side__icon"><Icon name={it.icon} /></span>
                  <span className="cm-side__label">{it.label}</span>
                  {badge && !collapsed && <span className="cm-side__badge">{badge}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="cm-side__foot">
        <button className="cm-side__foot-btn" onClick={onToggle} aria-label="Colapsar sidebar">
          <Icon name="panelLeft" size={16} />
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}
