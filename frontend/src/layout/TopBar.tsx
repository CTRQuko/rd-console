import { ChevronDown, Moon, Sun } from 'lucide-react';
import type { AuthUser } from '@/types/api';

interface TopBarProps {
  title: string;
  breadcrumb?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user: AuthUser | null;
}

export function TopBar({ title, breadcrumb, theme, onToggleTheme, user }: TopBarProps) {
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
          className="rd-iconbtn"
          onClick={onToggleTheme}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div className="rd-topbar__user">
          <div className="rd-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
            {(user?.username?.[0] ?? 'A').toUpperCase()}
          </div>
          <span className="rd-topbar__user-name">{user?.username ?? 'admin'}</span>
          <ChevronDown size={14} style={{ color: 'var(--fg-muted)' }} />
        </div>
      </div>
    </div>
  );
}
