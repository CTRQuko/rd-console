import { NavLink } from 'react-router-dom';
import {
  FileText,
  LayoutDashboard,
  LogOut,
  Monitor,
  Settings as SettingsIcon,
  Tag as TagIcon,
  Users as UsersIcon,
} from 'lucide-react';
import type { AuthUser } from '@/types/api';

const NAV_ITEMS = [
  { to: '/',         label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/users',    label: 'Users',     Icon: UsersIcon },
  { to: '/devices',  label: 'Devices',   Icon: Monitor },
  { to: '/tags',     label: 'Tags',      Icon: TagIcon },
  { to: '/logs',     label: 'Logs',      Icon: FileText },
  { to: '/settings', label: 'Settings',  Icon: SettingsIcon },
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
