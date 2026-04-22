/** Shared test helpers. Keeps every page test on the same query-client +
 *  MSW handler set so cross-talk between pages (e.g. invalidated queries
 *  from one test bleeding into another) stays contained.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';

import { useAuthStore } from '@/store/authStore';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

interface WrapOpts {
  queryClient?: QueryClient;
  initialRoute?: string;
}

export function wrap(ui: ReactElement, opts: WrapOpts = {}): RenderResult {
  const qc = opts.queryClient ?? makeQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[opts.initialRoute ?? '/']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

/** Seed the auth store as a logged-in admin so API calls get a bearer token. */
export function signInAsAdmin(username = 'admin') {
  useAuthStore.getState().login({ username, role: 'Admin' }, 'test-token-123');
}
