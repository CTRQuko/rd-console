import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthHasHydrated, useAuthStore } from './authStore';

describe('authStore', () => {
  it('login sets user + token, logout clears them', () => {
    act(() => {
      useAuthStore.getState().login({ username: 'admin', role: 'Admin' }, 'tok');
    });
    expect(useAuthStore.getState().user?.username).toBe('admin');
    expect(useAuthStore.getState().token).toBe('tok');

    act(() => useAuthStore.getState().logout());
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('persists to localStorage under rd:auth', () => {
    act(() => {
      useAuthStore.getState().login({ username: 'jane', role: 'User' }, 'jwt.abc');
    });
    const stored = JSON.parse(localStorage.getItem('rd:auth') ?? '{}');
    expect(stored.state.user.username).toBe('jane');
    expect(stored.state.token).toBe('jwt.abc');
  });

  it('useAuthHasHydrated returns true after rehydration', () => {
    // In tests Zustand hydrates synchronously from memory; hasHydrated is true
    // immediately after the module loads.
    const { result } = renderHook(() => useAuthHasHydrated());
    expect(result.current).toBe(true);
  });
});
