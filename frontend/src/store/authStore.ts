/** Zustand store for the panel session — user + JWT.
 *  Persists to localStorage so reloads don't log you out.
 *
 *  The `useAuthHasHydrated` hook is used by the router to gate rendering
 *  until localStorage rehydration completes — otherwise an authenticated
 *  reload flashes `/login` while Zustand's async hydration is in flight.
 */

import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/types/api';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: 'rd:auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    },
  ),
);

// External store pattern for hydration state. `useSyncExternalStore` is the
// React-approved escape hatch for subscribing to non-React state without
// sprinkling setState calls inside useEffect bodies (which would trip the
// react-hooks/set-state-in-effect lint rule).

function subscribeHydration(onChange: () => void): () => void {
  const unsubStart = useAuthStore.persist.onHydrate(onChange);
  const unsubEnd = useAuthStore.persist.onFinishHydration(onChange);
  return () => {
    unsubStart();
    unsubEnd();
  };
}

function getHydrationSnapshot(): boolean {
  return useAuthStore.persist.hasHydrated();
}

/** True once the persisted state has been read from localStorage.
 *  Render a gate on this before any auth-sensitive component mounts.
 */
export function useAuthHasHydrated(): boolean {
  return useSyncExternalStore(
    subscribeHydration,
    getHydrationSnapshot,
    getHydrationSnapshot,
  );
}
