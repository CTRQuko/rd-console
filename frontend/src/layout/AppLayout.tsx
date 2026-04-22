import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@/store/themeStore';

const TITLE_BY_PATH: Record<string, string> = {
  '/':         'Dashboard',
  '/users':    'Users',
  '/devices':  'Devices',
  '/tags':     'Tags',
  '/logs':     'Audit logs',
  '/settings': 'Settings',
};

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [theme, , toggleTheme] = useTheme();

  // Authentication gating is handled by <AuthedShell> in App.tsx; this layout
  // can assume a user exists by the time it renders.

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
        />
        <div className="rd-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
