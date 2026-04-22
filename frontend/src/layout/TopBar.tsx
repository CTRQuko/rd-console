import { Moon, Sun } from 'lucide-react';
import type { AuthUser } from '@/types/api';

interface TopBarProps {
  title: string;
  breadcrumb?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user: AuthUser | null;
}

export function TopBar({ title, breadcrumb, theme, onToggleTheme, user }: TopBarProps) {
  const initial = (user?.username?.[0] ?? 'A').toUpperCase();
  return (
    <div className="rd-topbar">
      <div className="rd-topbar__crumb">
        {breadcrumb ? (
          <>
            <span style={{ color: 'var(--fg-muted)' }}>{breadcrumb}</span>
            <span className="rd-topbar__crumb-sep">/</span>
          </>
        ) : null}
        <span>{title}</span>
      </div>
      <div className="rd-topbar__actions">
        <button
          type="button"
          className="rd-iconbtn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {/* Read-only identity chip. When a user menu ships, replace with a real dropdown. */}
        <div
          className="rd-topbar__user"
          title={user ? `Signed in as ${user.username}` : undefined}
          style={{ cursor: 'default' }}
        >
          <div className="rd-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
            {initial}
          </div>
          <span className="rd-topbar__user-name">{user?.username ?? 'admin'}</span>
        </div>
      </div>
    </div>
  );
}
