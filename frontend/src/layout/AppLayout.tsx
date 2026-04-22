import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CommandPalette } from '@/components/CommandPalette';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/store/themeStore';

const TITLE_BY_PATH: Record<string, string> = {
  '/':         'Dashboard',
  '/users':    'Users',
  '/devices':  'Devices',
  '/address-book': 'Address book',
  '/tags':     'Tags',
  '/logs':     'Audit logs',
  '/settings': 'Settings',
  '/account':  'Account',
};

/** Cmd+K (macOS) / Ctrl+K (other) opens the global search palette,
 *  unless the focus is in a text input — we don't want to hijack the
 *  user's typing. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [theme, , toggleTheme] = useTheme();

  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K';
      if (!isK) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = TITLE_BY_PATH[pathname] ?? 'rd-console';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="rd-layout">
      <Sidebar user={user} onLogout={handleLogout} />
      <main className="rd-main">
        <TopBar
          title={title}
          breadcrumb="rd-console"
          theme={theme}
          onToggleTheme={toggleTheme}
          user={user}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <div className="rd-content">
          <Outlet />
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
