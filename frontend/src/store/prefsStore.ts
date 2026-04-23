/** User-visible appearance + general preferences — persisted to
 *  localStorage as `rd:prefs`. Applies accent as a data-attribute on
 *  <html> so CSS rules can override HSL variables without JS recomputing
 *  styles.
 *
 *  v7 added four "General" fields (landingPage, language, dateTimeFormat,
 *  timezone) that consumers read independently — they do NOT need to be
 *  mirrored to <html>, they're just persisted preferences.
 */

import { useEffect, useState } from 'react';

export type Accent =
  | 'blue'
  | 'violet'
  | 'green'
  | 'amber'
  | 'rose'
  | 'teal';

export type LandingPage =
  | '/'
  | '/devices'
  | '/address-book'
  | '/join-tokens'
  | '/logs'
  | '/settings';

export type Language = 'es' | 'en' | 'fr' | 'de' | 'pt';

export type DateTimeFormat =
  | 'system'   // Intl default, browser locale
  | 'iso'      // 2026-04-23 14:30
  | 'eu'       // 23 abr 2026 14:30
  | 'us'       // Apr 23, 2026, 14:30
  | 'relative' // "hace 2 min", falls back to absolute for >7d
  ;

/** Either the browser's resolved timezone (`browser`), UTC, or an IANA
 *  identifier from the curated list shown in the Settings UI. */
export type Timezone = string;

export interface Prefs {
  // Appearance (v6)
  accent: Accent;
  /** Multiplier applied to the root font-size via `--rd-font-scale`.
   *  Kept as a number because the slider is continuous; persisted as-is. */
  fontScale: number;
  // General (v7)
  landingPage: LandingPage;
  language: Language;
  dateTimeFormat: DateTimeFormat;
  timezone: Timezone;
}

function detectInitialLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language || '').slice(0, 2).toLowerCase();
  return (['es', 'en', 'fr', 'de', 'pt'] as const).includes(lang as Language)
    ? (lang as Language)
    : 'en';
}

export const DEFAULT_PREFS: Prefs = {
  accent: 'blue',
  fontScale: 1,
  landingPage: '/',
  language: detectInitialLanguage(),
  dateTimeFormat: 'system',
  timezone: 'browser',
};

export const ACCENT_SWATCHES: { value: Accent; hex: string; label: string }[] = [
  { value: 'blue',   hex: '#2563eb', label: 'Blue' },
  { value: 'violet', hex: '#8b5cf6', label: 'Violet' },
  { value: 'green',  hex: '#16a34a', label: 'Green' },
  { value: 'amber',  hex: '#f59e0b', label: 'Amber' },
  { value: 'rose',   hex: '#f43f5e', label: 'Rose' },
  { value: 'teal',   hex: '#0891b2', label: 'Teal' },
];

/** The curated IANA list the Settings UI offers. Not every possible
 *  zone — just a spread of common ones, plus the special `browser` and
 *  `UTC` values. Extending here is a one-line change. */
export const TIMEZONE_CHOICES: { value: Timezone; label: string }[] = [
  { value: 'browser',           label: 'Browser default (auto)' },
  { value: 'UTC',               label: 'UTC' },
  { value: 'Europe/Madrid',     label: 'Europe — Madrid' },
  { value: 'Europe/London',     label: 'Europe — London' },
  { value: 'Europe/Berlin',     label: 'Europe — Berlin' },
  { value: 'Europe/Paris',      label: 'Europe — Paris' },
  { value: 'America/New_York',  label: 'America — New York' },
  { value: 'America/Los_Angeles', label: 'America — Los Angeles' },
  { value: 'America/Sao_Paulo', label: 'America — São Paulo' },
  { value: 'Asia/Tokyo',        label: 'Asia — Tokyo' },
  { value: 'Asia/Shanghai',     label: 'Asia — Shanghai' },
  { value: 'Australia/Sydney',  label: 'Australia — Sydney' },
];

export const DATE_TIME_FORMAT_CHOICES: { value: DateTimeFormat; label: string; example: string }[] = [
  { value: 'system',   label: 'Sync with system locale', example: 'Browser default' },
  { value: 'iso',      label: 'ISO compact',             example: '2026-04-23 14:30' },
  { value: 'eu',       label: 'European (es-ES)',        example: '23 abr 2026 14:30' },
  { value: 'us',       label: 'US (en-US)',              example: 'Apr 23, 2026, 2:30 PM' },
  { value: 'relative', label: 'Relative',                example: '2 hours ago' },
];

export const LANGUAGE_CHOICES: { value: Language; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
];

export const LANDING_PAGE_CHOICES: { value: LandingPage; label: string }[] = [
  { value: '/',              label: 'Dashboard' },
  { value: '/devices',       label: 'Devices' },
  { value: '/address-book',  label: 'Address book' },
  { value: '/join-tokens',   label: 'Join tokens' },
  { value: '/logs',          label: 'Audit logs' },
  { value: '/settings',      label: 'Settings' },
];

const STORAGE_KEY = 'rd:prefs';

// ─── Validators (per field) ───────────────────────────────────────────────
// Each returns either the validated value or `null` if unknown — the
// caller falls back to the default. Silent rejection is intentional:
// old localStorage blobs from earlier versions shouldn't surface as
// user-facing errors.

function isAccent(v: unknown): v is Accent {
  return ['blue', 'violet', 'green', 'amber', 'rose', 'teal'].includes(v as string);
}
function isLandingPage(v: unknown): v is LandingPage {
  return ['/', '/devices', '/address-book', '/join-tokens', '/logs', '/settings']
    .includes(v as string);
}
function isLanguage(v: unknown): v is Language {
  return ['es', 'en', 'fr', 'de', 'pt'].includes(v as string);
}
function isDateTimeFormat(v: unknown): v is DateTimeFormat {
  return ['system', 'iso', 'eu', 'us', 'relative'].includes(v as string);
}
function isTimezone(v: unknown): v is Timezone {
  if (typeof v !== 'string') return false;
  if (v === 'browser' || v === 'UTC') return true;
  // Accept IANA-looking strings (Region/City) but only if Intl actually
  // recognises the zone — catches typos like "Not/AZone" which would
  // otherwise match a loose regex and then blow up `Intl.DateTimeFormat`.
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Read from localStorage with per-field validation. Unknown / missing
 *  values fall back to DEFAULT_PREFS. Legacy keys from earlier versions
 *  (density, radius, sidebarStyle) are ignored silently. */
function readInitial(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      accent: isAccent(p.accent) ? p.accent : DEFAULT_PREFS.accent,
      fontScale:
        typeof p.fontScale === 'number' &&
        p.fontScale >= 0.85 &&
        p.fontScale <= 1.2
          ? p.fontScale
          : DEFAULT_PREFS.fontScale,
      landingPage: isLandingPage(p.landingPage) ? p.landingPage : DEFAULT_PREFS.landingPage,
      language: isLanguage(p.language) ? p.language : DEFAULT_PREFS.language,
      dateTimeFormat: isDateTimeFormat(p.dateTimeFormat)
        ? p.dateTimeFormat
        : DEFAULT_PREFS.dateTimeFormat,
      timezone: isTimezone(p.timezone) ? p.timezone : DEFAULT_PREFS.timezone,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyPrefsToDom(prefs: Prefs): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.setAttribute('data-accent', prefs.accent);
  html.style.setProperty('--rd-font-scale', String(prefs.fontScale));
  // Clean up attributes from pre-v7 prefs (density, radius, sidebar)
  // so devtools stays clean if a user carried state across releases.
  html.removeAttribute('data-density');
  html.removeAttribute('data-radius');
  html.removeAttribute('data-sidebar');
  // landingPage / language / dateTimeFormat / timezone don't need DOM
  // mirroring — they're read directly by the consumers that care.
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
