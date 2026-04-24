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
