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
// Side-effect import: initialises i18next + loads all 5 locale bundles.
// Without this, components that call `useTranslation()` would render the
// raw translation keys (e.g. "common:actions.sign_in") instead of the
// resolved English/Spanish/etc. text — and `getByRole(name: /sign in/i)`
// queries would miss them.
import i18n from '@/lib/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  resetApiMock();
  // Zustand store is module-level — reset between tests to stop a logged-in
  // admin from leaking across files.
  useAuthStore.setState({ user: null, token: null });
});

beforeEach(async () => {
  // Force English so test queries that use English regex (e.g. /sign in/i)
  // remain stable across machines whose locale detector might land on es,
  // pt, fr or de.
  if (i18n.language !== 'en') {
    await i18n.changeLanguage('en');
  }
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
