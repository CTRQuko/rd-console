import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuthStore } from '@/store/authStore';

const TITLE_BY_PATH: Record<string, string> = {
  '/':         'Dashboard',
  '/users':    'Users',
  '/devices':  'Devices',
  '/logs':     'Audit logs',
  '/settings': 'Settings',
};

type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('rd:theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    localStorage.setItem('rd:theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Gate: if no session, bounce to /login.
  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

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
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          user={user}
        />
        <div className="rd-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
