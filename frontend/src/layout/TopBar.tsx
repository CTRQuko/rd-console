import { Moon, Search, Sun } from 'lucide-react';
import type { AuthUser } from '@/types/api';

interface TopBarProps {
  title: string;
  breadcrumb?: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user: AuthUser | null;
  onOpenSearch?: () => void;
}

export function TopBar({
  title,
  breadcrumb,
  theme,
  onToggleTheme,
  user,
  onOpenSearch,
}: TopBarProps) {
  const initial = (user?.username?.[0] ?? 'A').toUpperCase();
  // Prefer "⌘K" on macOS, "Ctrl K" elsewhere. Best-effort sniff; not critical.
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPad|iPhone/.test(navigator.platform);
  const searchHint = isMac ? '⌘K' : 'Ctrl K';

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
        {onOpenSearch ? (
          <button
            type="button"
            className="rd-btn rd-btn--secondary rd-btn--sm"
            onClick={onOpenSearch}
            title="Global search"
            aria-label="Open global search"
            style={{ gap: 8 }}
          >
            <Search size={14} />
            <span style={{ color: 'var(--fg-muted)' }}>Search</span>
            <kbd
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '1px 5px',
                border: '1px solid var(--border)',
                borderRadius: 3,
                background: 'var(--bg)',
                color: 'var(--fg-muted)',
                font: '500 10px/1 var(--font-mono)',
                marginLeft: 4,
              }}
            >
              {searchHint}
            </kbd>
          </button>
        ) : null}
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
