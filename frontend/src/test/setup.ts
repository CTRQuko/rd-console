/** Global test setup additions for v2 pages.
 *
 *  Append these lines to src/test/setup.ts (or swap the file wholesale —
 *  they are idempotent with the existing setup).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetApiMock } from './apiMock';
import { useAuthStore } from '@/store/authStore';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  resetApiMock();
  // Zustand store is module-level — reset between tests to stop a logged-in
  // admin from leaking across files.
  useAuthStore.setState({ user: null, token: null });
});

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});
