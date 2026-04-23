import { NavLink } from 'react-router-dom';
import {
  BookUser,
  FileText,
  LayoutDashboard,
  LogOut,
  Monitor,
  Send,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { AuthUser } from '@/types/api';

// Users + API tokens live inside Settings tabs (v6 P6-B). The
// sidebar keeps only day-to-day destinations; configuration surfaces
// concentrate under /settings.
const NAV_ITEMS = [
  { to: '/',             label: 'Dashboard',    Icon: LayoutDashboard },
  { to: '/devices',      label: 'Devices',      Icon: Monitor },
  { to: '/address-book', label: 'Address book', Icon: BookUser },
  { to: '/join-tokens',  label: 'Join tokens',  Icon: Send },
  { to: '/logs',         label: 'Logs',         Icon: FileText },
  { to: '/settings',     label: 'Settings',     Icon: SettingsIcon },
] as const;

interface SidebarProps {
  user: AuthUser | null;
  onLogout: () => void;
}

export function Sidebar({ user, onLogout }: SidebarProps) {
  return (
    <aside className="rd-sidebar">
      <div className="rd-sidebar__brand">
        <Monitor size={20} style={{ color: '#3b82f6' }} />
        <span className="rd-sidebar__brand-name">rd-console</span>
        <span className="rd-sidebar__ver">v0.1.0</span>
      </div>
      <nav className="rd-sidebar__nav">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `rd-sidebar__item ${isActive ? 'active' : ''}`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="rd-sidebar__foot">
        <div className="rd-avatar">{(user?.username?.[0] ?? 'A').toUpperCase()}</div>
        <div className="rd-sidebar__user">
          <div className="rd-sidebar__user-name">{user?.username ?? 'admin'}</div>
          <div className="rd-sidebar__user-role">{user?.role ?? 'Admin'}</div>
        </div>
        <button
          className="rd-sidebar__logout"
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}
