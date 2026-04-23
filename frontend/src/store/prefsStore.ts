/** User-visible appearance preferences — persisted to localStorage as
 *  `rd:prefs`. Applies as data-attributes on <html> so CSS rules can
 *  override HSL variables without JS recomputing styles.
 *
 *  Kept separate from themeStore (light/dark) so the existing toggle
 *  stays working during transition. Theme itself is still owned by
 *  themeStore; this module covers accent, density, radius, fontScale,
 *  sidebarStyle.
 */

import { useEffect, useState } from 'react';

export type Accent =
  | 'blue'
  | 'violet'
  | 'green'
  | 'amber'
  | 'rose'
  | 'teal';
export type SidebarStyle = 'always-dark' | 'follow-theme';

export interface Prefs {
  accent: Accent;
  /** Multiplier applied to the root font-size via `--rd-font-scale`.
   *  Kept as a number because the slider is continuous; persisted as-is. */
  fontScale: number;
  sidebarStyle: SidebarStyle;
}

export const DEFAULT_PREFS: Prefs = {
  accent: 'blue',
  fontScale: 1,
  sidebarStyle: 'always-dark',
};

export const ACCENT_SWATCHES: { value: Accent; hex: string; label: string }[] = [
  { value: 'blue',   hex: '#2563eb', label: 'Blue' },
  { value: 'violet', hex: '#8b5cf6', label: 'Violet' },
  { value: 'green',  hex: '#16a34a', label: 'Green' },
  { value: 'amber',  hex: '#f59e0b', label: 'Amber' },
  { value: 'rose',   hex: '#f43f5e', label: 'Rose' },
  { value: 'teal',   hex: '#0891b2', label: 'Teal' },
];

const STORAGE_KEY = 'rd:prefs';

function isAccent(v: unknown): v is Accent {
  return ['blue', 'violet', 'green', 'amber', 'rose', 'teal'].includes(v as string);
}
function isSidebar(v: unknown): v is SidebarStyle {
  return ['always-dark', 'follow-theme'].includes(v as string);
}

/** Read from localStorage with per-field validation. Unknown values fall
 *  back to DEFAULT_PREFS so a stale payload from a previous version
 *  (e.g. "density": "tight") never breaks the UI. */
function readInitial(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    // density + radius were shipped in PR #30 but removed in P4 (never
    // actually worked for the flat rd-* components). Ignore if present
    // in an older localStorage blob.
    return {
      accent: isAccent(parsed.accent) ? parsed.accent : DEFAULT_PREFS.accent,
      fontScale:
        typeof parsed.fontScale === 'number' &&
        parsed.fontScale >= 0.85 &&
        parsed.fontScale <= 1.2
          ? parsed.fontScale
          : DEFAULT_PREFS.fontScale,
      sidebarStyle: isSidebar(parsed.sidebarStyle)
        ? parsed.sidebarStyle
        : DEFAULT_PREFS.sidebarStyle,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefsToDom(prefs: Prefs): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.setAttribute('data-accent', prefs.accent);
  html.setAttribute('data-sidebar', prefs.sidebarStyle);
  html.style.setProperty('--rd-font-scale', String(prefs.fontScale));
  // Clean up legacy attributes from pre-P4 prefs — if a user had PR #30
  // stored, these would still sit on <html> and match the dead CSS rules
  // (harmless but confusing in devtools).
  html.removeAttribute('data-density');
  html.removeAttribute('data-radius');
}

/** Hook returning `[prefs, setPrefs, resetPrefs]`. Mutations are immediate
 *  — DOM + localStorage updated before React re-renders. */
export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void, () => void] {
  const [prefs, setPrefsState] = useState<Prefs>(readInitial);

  useEffect(() => {
    applyPrefsToDom(prefs);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage full / private mode — applying DOM still works */
    }
  }, [prefs]);

  // Sync across tabs — matching themeStore's behaviour.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        setPrefsState((prev) => ({ ...prev, ...parsed }));
      } catch {
        /* malformed — ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((prev) => ({ ...prev, ...patch }));
  const reset = () => setPrefsState(DEFAULT_PREFS);
  return [prefs, setPrefs, reset];
}
