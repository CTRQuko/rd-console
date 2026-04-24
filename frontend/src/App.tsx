import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AddressBookPage } from '@/pages/AddressBookPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { JoinPage } from '@/pages/JoinPage';
import { JoinTokensPage } from '@/pages/JoinTokensPage';
import { LoginPage } from '@/pages/LoginPage';
import { LogsPage } from '@/pages/LogsPage';
import { RedirectToSettingsTab, SettingsPage } from '@/pages/SettingsPage';
// v6 P5 — TagsPage removed, tags are now auto-generated.
// v6 P6-B — UsersPage + AccountPage moved into Settings tabs. Old routes
// are preserved as redirects so bookmarks keep working.
import { useAuthHasHydrated, useAuthStore } from '@/store/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // 5s was 30s before v8. At 30s + refetchInterval: 30s on useDevices
      // the dead window between "still fresh" and "next poll" stretched to
      // nearly 60s, which the operator saw as "the list doesn't update when
      // I plug in a new peer". 5s ensures every hook's refetchInterval
      // actually hits the backend rather than dedup'ing against a
      // still-fresh cache.
      staleTime: 5_000,
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
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/address-book" element={<AddressBookPage />} />
        <Route path="/join-tokens" element={<JoinTokensPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* Legacy routes — redirect to the Settings tab that absorbed them. */}
        <Route path="/users" element={<RedirectToSettingsTab tab="users" />} />
        <Route path="/account" element={<RedirectToSettingsTab tab="api-tokens" />} />
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
