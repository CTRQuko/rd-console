import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AccountPage } from '@/pages/AccountPage';
import { AddressBookPage } from '@/pages/AddressBookPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { JoinPage } from '@/pages/JoinPage';
import { LoginPage } from '@/pages/LoginPage';
import { LogsPage } from '@/pages/LogsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TagsPage } from '@/pages/TagsPage';
import { UsersPage } from '@/pages/UsersPage';
import { useAuthHasHydrated, useAuthStore } from '@/store/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function AuthedShell() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

function HydrationGate() {
  // Zustand's persist middleware reads localStorage asynchronously. Until
  // hydration finishes, `user` is always null and an authenticated reload
  // would flash /login. Render a neutral placeholder during hydration.
  const hydrated = useAuthHasHydrated();
  if (!hydrated) {
    return (
      <div
        className="rd-center"
        role="status"
        aria-live="polite"
        style={{ color: 'var(--fg-muted)' }}
      >
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route element={<AuthedShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/address-book" element={<AddressBookPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <HydrationGate />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
