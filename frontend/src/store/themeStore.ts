/** Theme preference — persisted to localStorage as `rd:theme`.
 *  An inline script in index.html reads this key BEFORE React hydrates so
 *  there is no dark-mode flash. This store keeps React in sync after mount.
 */

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'rd:theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyToDom(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** React hook returning `[theme, setTheme, toggle]`. */
export function useTheme(): [Theme, (t: Theme) => void, () => void] {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  useEffect(() => {
    applyToDom(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode / quota — fine */
    }
  }, [theme]);

  // Keep in sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'dark' || e.newValue === 'light') setThemeState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, setThemeState, toggle];
}
