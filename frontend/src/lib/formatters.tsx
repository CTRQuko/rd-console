/** Date/time formatting that respects the user's Prefs.
 *
 *  Before v7 every page had its own mini-formatter (`.toISOString()
 *  .slice(0, 16).replace('T', ' ')`). v7 introduces a format + timezone
 *  pref pair; this module wraps `Intl.DateTimeFormat` /
 *  `Intl.RelativeTimeFormat` and gives the rest of the codebase ONE
 *  way to render a timestamp.
 *
 *  Callsites:
 *    const { fmt } = useDateTime();
 *    <td>{fmt(row.created_at)}</td>
 *
 *  Or as a component:
 *    <DateTime value={row.created_at} />
 *
 *  Backend contract: all server timestamps come as ISO-8601 without
 *  timezone (e.g. `2026-04-23T14:30:00`). SQLite `datetime(...)` is
 *  implicitly UTC in this codebase. The formatter interprets strings
 *  without an explicit offset/Z as UTC, then converts to the pref'd
 *  timezone.
 *
 *  Locale handling: `system` and `relative` formats follow the active
 *  i18n language so "hace 3 minutos" / "il y a 3 minutes" flip in sync
 *  with the UI language. `eu` / `us` are anchored to their locale
 *  regardless (that's the whole point of picking them explicitly). The
 *  hook variant reads `useTranslation().i18n.language` so it re-renders
 *  on language change; the standalone `fmtDateTime` falls back to the
 *  i18next singleton.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { usePrefs, type DateTimeFormat, type Timezone } from '@/store/prefsStore';

// ─── Supported formats ────────────────────────────────────────────────────

/** Locale strings the non-system formats use. The `system` format uses
 *  the active i18n language (fallback: browser locale). */
const LOCALE_BY_FORMAT: Record<Exclude<DateTimeFormat, 'system' | 'iso' | 'relative'>, string> = {
  eu: 'es-ES',
  us: 'en-US',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse an ISO string. Strings without Z/offset are treated as UTC. */
function parseIso(iso: string): Date | null {
  if (!iso) return null;
  const hasTz = /[Zz]$|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

/** Resolve `browser` / `UTC` / `Europe/Madrid`… to an Intl timeZone value. */
function resolveTimezone(tz: Timezone): string | undefined {
  if (tz === 'browser') return undefined; // Intl default
  return tz;
}

/** Relative format with absolute fallback for >7d deltas. */
function formatRelative(date: Date, now: Date = new Date(), locale?: string): string {
  if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') {
    // Fallback — browsers too old for RelativeTimeFormat get ISO-ish.
    return date.toISOString().replace('T', ' ').slice(0, 16);
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = date.getTime() - now.getTime();
  const absSec = Math.abs(diffMs / 1000);

  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60000), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  if (absSec < 7 * 86400) return rtf.format(Math.round(diffMs / 86400000), 'day');

  // Beyond a week, relative gets unreadable ("3 months ago" vs the actual date).
  // Fall back to an absolute render so the user knows exactly when.
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

// ─── Core formatter ───────────────────────────────────────────────────────

export interface FmtOptions {
  format: DateTimeFormat;
  timezone: Timezone;
  /** Locale override. Defaults to the active i18n language. Ignored by
   *  `eu` / `us` / `iso` formats which anchor to their own locale. */
  locale?: string;
}

export function fmtDateTime(
  iso: string | null | undefined,
  opts: FmtOptions,
): string {
  if (!iso) return '—';
  const date = parseIso(iso);
  if (!date) return '—';

  const timeZone = resolveTimezone(opts.timezone);
  const resolvedLocale = opts.locale ?? i18n.language;

  switch (opts.format) {
    case 'iso':
      // Keep the original compact form so LogsPage etc. stay familiar.
      // Still respects the timezone — builds the ISO manually with the
      // chosen offset.
      return new Intl.DateTimeFormat('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      }).format(date).replace(/,/g, '').trim();
    case 'eu':
    case 'us':
      return new Intl.DateTimeFormat(LOCALE_BY_FORMAT[opts.format], {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(date);
    case 'relative':
      return formatRelative(date, undefined, resolvedLocale);
    case 'system':
    default:
      return new Intl.DateTimeFormat(resolvedLocale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(date);
  }
}

/** Date-only variant — ignores the time component. Used where the
 *  legacy `.slice(0, 10)` was in place (UsersPage "Created" column). */
export function fmtDate(
  iso: string | null | undefined,
  opts: FmtOptions,
): string {
  if (!iso) return '—';
  const date = parseIso(iso);
  if (!date) return '—';
  const timeZone = resolveTimezone(opts.timezone);
  const resolvedLocale = opts.locale ?? i18n.language;

  if (opts.format === 'iso') {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(date);
  }
  if (opts.format === 'relative') {
    // Date-only relative rarely makes sense; fall back to absolute.
    return new Intl.DateTimeFormat(resolvedLocale, {
      dateStyle: 'medium',
      timeZone,
    }).format(date);
  }
  const locale =
    opts.format === 'eu'
      ? 'es-ES'
      : opts.format === 'us'
        ? 'en-US'
        : resolvedLocale;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone,
  }).format(date);
}

// ─── React hook + component ───────────────────────────────────────────────

/** Hook version — reads prefs + active i18n language, returns stable
 *  formatters. Re-renders automatically when either changes. */
export function useDateTime() {
  const [prefs] = usePrefs();
  const { i18n: i18nInst } = useTranslation();
  const lang = i18nInst.language;
  return useMemo(
    () => ({
      fmt: (iso: string | null | undefined) =>
        fmtDateTime(iso, {
          format: prefs.dateTimeFormat,
          timezone: prefs.timezone,
          locale: lang,
        }),
      fmtDateOnly: (iso: string | null | undefined) =>
        fmtDate(iso, {
          format: prefs.dateTimeFormat,
          timezone: prefs.timezone,
          locale: lang,
        }),
    }),
    [prefs.dateTimeFormat, prefs.timezone, lang],
  );
}

interface DateTimeProps {
  value: string | null | undefined;
  /** `datetime` (default) shows date + time. `date` shows date only. */
  mode?: 'datetime' | 'date';
  /** Optional CSS class for inline styling of the resulting span. */
  className?: string;
}

export function DateTime({ value, mode = 'datetime', className }: DateTimeProps) {
  const { fmt, fmtDateOnly } = useDateTime();
  const rendered = mode === 'date' ? fmtDateOnly(value) : fmt(value);
  return <span className={className}>{rendered}</span>;
}

// ─── Last-seen status (device presence heuristic) ─────────────────────────

/** Tier derived from how fresh a device's `last_seen_at` is. Used by the
 *  `OnlineBadge` to color-code presence without pretending it's real-time
 *  (the free-tier rustdesk-server doesn't expose that — see
 *  `docs/servicios/rustdesk-lxc-105/online-detection-limitation.md`).
 *
 *  - `fresh`  — seen within 15 min: very likely connected right now.
 *  - `stale`  — within the last 24h: was active recently, state unclear now.
 *  - `cold`   — older than 24h: dormant / powered off / rarely used.
 *  - `unknown`— never seen (null timestamp).
 */
export type LastSeenTier = 'fresh' | 'stale' | 'cold' | 'unknown';

export interface LastSeenStatus {
  tier: LastSeenTier;
  /** Human-readable label for the badge — already localised. */
  label: string;
  /** Hover text explaining what the badge actually represents. */
  tooltip: string;
}

/** i18n-aware computation of the presence tier + label. The second arg is
 *  a `t()` function (from `react-i18next`'s `useTranslation`); the caller
 *  injects it so this file doesn't need to import react-i18next directly
 *  (keeps it unit-testable without a full i18n bootstrap). Expected keys:
 *
 *    - `device_status.never`
 *    - `device_status.just_now`
 *    - `device_status.recent`   — receives interpolation `{{ago}}`
 *    - `device_status.old`      — receives interpolation `{{ago}}`
 *    - `device_status.tooltip`
 */
export function lastSeenStatus(
  iso: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  now: Date = new Date(),
): LastSeenStatus {
  const tooltip = t('device_status.tooltip');
  if (!iso) {
    return { tier: 'unknown', label: t('device_status.never'), tooltip };
  }
  const date = parseIso(iso);
  if (!date) {
    return { tier: 'unknown', label: t('device_status.never'), tooltip };
  }
  const minsAgo = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minsAgo < 15) {
    return { tier: 'fresh', label: t('device_status.just_now'), tooltip };
  }
  const ago = formatRelative(date, now);
  if (minsAgo < 60 * 24) {
    return { tier: 'stale', label: t('device_status.recent', { ago }), tooltip };
  }
  return { tier: 'cold', label: t('device_status.old', { ago }), tooltip };
}

// ─── Misc date utilities ──────────────────────────────────────────────────

/** Whether an ISO timestamp has already passed. `null`/`undefined` returns
 *  false — a token with `expires_at=null` is "never expires", not "expired".
 *  Malformed ISO strings also return false (fail-soft: a broken field
 *  shouldn't nuke the UI into expiry mode). */
export function isExpired(
  iso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!iso) return false;
  const date = parseIso(iso);
  if (!date) return false;
  return date.getTime() <= now.getTime();
}

/** Compute the ISO timestamp at the start of a named range — used by the
 *  LogsPage filter dropdown. Extracted so the lookup logic lives in one
 *  place instead of scattered inline `new Date()` arithmetic. */
export function sinceIsoRange(
  range: 'today' | '7d' | '30d' | 'all',
  now: Date = new Date(),
): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date(now);
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    d.setDate(d.getDate() - 7);
  } else {
    d.setDate(d.getDate() - 30);
  }
  return d.toISOString();
}
