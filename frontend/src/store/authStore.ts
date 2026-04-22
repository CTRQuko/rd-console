/** Zustand store for the panel session — user + JWT.
 *  Persists to localStorage so reloads don't log you out.
 *
 *  The `useAuthHasHydrated` hook is used by the router to gate rendering
 *  until localStorage rehydration completes — otherwise an authenticated
 *  reload flashes `/login` while Zustand's async hydration is in flight.
 */

import { useEffect, useState } from 'react';
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

/** True once the persisted state has been read from localStorage.
 *  Render a gate on this before any auth-sensitive component mounts.
 */
export function useAuthHasHydrated(): boolean {
  const [hydrated, setHydrated] = useState(useAuthStore.persist.hasHydrated());

  useEffect(() => {
    // Mark false if a rehydration is kicked off after mount (e.g. storage
    // event from another tab), true when it finishes.
    const unsubStart = useAuthStore.persist.onHydrate(() => setHydrated(false));
    const unsubEnd = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    // Resolve current state in case hydration finished between render and effect.
    setHydrated(useAuthStore.persist.hasHydrated());
    return () => {
      unsubStart();
      unsubEnd();
    };
  }, []);

  return hydrated;
}
