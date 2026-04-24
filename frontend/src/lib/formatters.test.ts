import { describe, expect, it } from 'vitest';
import {
  fmtDate,
  fmtDateTime,
  isExpired,
  lastSeenStatus,
  sinceIsoRange,
} from './formatters';

// A fixed instant: 14:30 UTC on 23 April 2026.
const UTC_ISO = '2026-04-23T14:30:00';

describe('fmtDateTime', () => {
  it('returns the em-dash for null/undefined/empty', () => {
    expect(fmtDateTime(null, { format: 'iso', timezone: 'UTC' })).toBe('—');
    expect(fmtDateTime(undefined, { format: 'iso', timezone: 'UTC' })).toBe('—');
    expect(fmtDateTime('', { format: 'iso', timezone: 'UTC' })).toBe('—');
  });

  it('returns the em-dash for malformed ISO strings', () => {
    expect(
      fmtDateTime('not-a-date', { format: 'iso', timezone: 'UTC' }),
    ).toBe('—');
  });

  it('treats ISO strings without an explicit zone as UTC', () => {
    // The backend emits "2026-04-23T14:30:00" (no Z). Under UTC pref
    // the output must be the same wall-clock 14:30.
    const out = fmtDateTime(UTC_ISO, { format: 'iso', timezone: 'UTC' });
    expect(out).toContain('14:30');
    expect(out).toContain('2026-04-23');
  });

  it('respects the timezone preference — Europe/Madrid adds +02:00 in DST', () => {
    // 14:30 UTC on 23 April is summer in Madrid (CEST, +02:00). So the
    // wall-clock shown should be 16:30.
    const out = fmtDateTime(UTC_ISO, {
      format: 'iso',
      timezone: 'Europe/Madrid',
    });
    expect(out).toContain('16:30');
  });

  it('eu format uses es-ES locale + dateStyle=medium', () => {
    // Spanish medium-format April is "abr".
    const out = fmtDateTime(UTC_ISO, { format: 'eu', timezone: 'UTC' });
    expect(out.toLowerCase()).toContain('abr');
  });

  it('us format uses en-US locale', () => {
    const out = fmtDateTime(UTC_ISO, { format: 'us', timezone: 'UTC' });
    expect(out).toContain('Apr');
    expect(out).toContain('2026');
  });

  it('relative format falls back to absolute for >7 day deltas', () => {
    // 2026-04-23 is (at the time of writing) decades away; "in 2 months"
    // is not stable, but the >7-day branch returns the absolute format.
    const out = fmtDateTime('2020-01-01T00:00:00', {
      format: 'relative',
      timezone: 'UTC',
    });
    // Should contain a year — absolute fallback. Not a relative phrase
    // like "X ago".
    expect(out).toMatch(/2020|2019/);
  });

  it('honours ISO strings that already carry a Z suffix', () => {
    const out = fmtDateTime('2026-04-23T14:30:00Z', {
      format: 'iso',
      timezone: 'UTC',
    });
    expect(out).toContain('14:30');
  });
});

describe('fmtDate', () => {
  it('returns only a date component (no time) for iso format', () => {
    const out = fmtDate(UTC_ISO, { format: 'iso', timezone: 'UTC' });
    // YYYY-MM-DD, no HH:MM.
    expect(out).toBe('2026-04-23');
    expect(out).not.toContain(':');
  });

  it('returns em-dash for null', () => {
    expect(fmtDate(null, { format: 'iso', timezone: 'UTC' })).toBe('—');
  });
});

describe('lastSeenStatus', () => {
  // A deterministic "now" keeps the thresholds stable across timezones /
  // CI clocks. Pick a date/time in the middle of April so there is no
  // DST surprise and all minutes are easy to reason about.
  const NOW = new Date('2026-04-23T12:00:00Z');

  // Fake `t()` — returns the key with interpolation suffix so we can
  // assert against it without bootstrapping real i18next.
  const t = (key: string, opts?: Record<string, unknown>) => {
    if (!opts) return key;
    const ago = opts.ago;
    return typeof ago === 'string' ? `${key}[${ago}]` : key;
  };

  it('null ISO → tier=unknown, "never" label', () => {
    const s = lastSeenStatus(null, t, NOW);
    expect(s.tier).toBe('unknown');
    expect(s.label).toBe('device_status.never');
    expect(s.tooltip).toBe('device_status.tooltip');
  });

  it('undefined ISO → tier=unknown (same path as null)', () => {
    const s = lastSeenStatus(undefined, t, NOW);
    expect(s.tier).toBe('unknown');
  });

  it('malformed ISO → tier=unknown', () => {
    const s = lastSeenStatus('not-a-date', t, NOW);
    expect(s.tier).toBe('unknown');
    expect(s.label).toBe('device_status.never');
  });

  it('0 minutes ago → fresh, "just_now"', () => {
    const s = lastSeenStatus(NOW.toISOString(), t, NOW);
    expect(s.tier).toBe('fresh');
    expect(s.label).toBe('device_status.just_now');
  });

  it('14 minutes ago → fresh (still within the 15-min cutoff)', () => {
    const iso = new Date(NOW.getTime() - 14 * 60_000).toISOString();
    const s = lastSeenStatus(iso, t, NOW);
    expect(s.tier).toBe('fresh');
  });

  it('16 minutes ago → stale (just past the 15-min cutoff)', () => {
    const iso = new Date(NOW.getTime() - 16 * 60_000).toISOString();
    const s = lastSeenStatus(iso, t, NOW);
    expect(s.tier).toBe('stale');
    expect(s.label).toMatch(/^device_status\.recent\[.+\]$/);
  });

  it('23 hours ago → stale (still within 24h)', () => {
    const iso = new Date(NOW.getTime() - 23 * 3600 * 1000).toISOString();
    const s = lastSeenStatus(iso, t, NOW);
    expect(s.tier).toBe('stale');
  });

  it('25 hours ago → cold (past the 24h cutoff)', () => {
    const iso = new Date(NOW.getTime() - 25 * 3600 * 1000).toISOString();
    const s = lastSeenStatus(iso, t, NOW);
    expect(s.tier).toBe('cold');
    expect(s.label).toMatch(/^device_status\.old\[.+\]$/);
  });

  it('many days ago → cold', () => {
    const iso = new Date(NOW.getTime() - 30 * 86400 * 1000).toISOString();
    const s = lastSeenStatus(iso, t, NOW);
    expect(s.tier).toBe('cold');
  });

  it('always includes the tooltip key regardless of tier', () => {
    for (const iso of [
      null,
      NOW.toISOString(),
      new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString(),
    ]) {
      expect(lastSeenStatus(iso, t, NOW).tooltip).toBe('device_status.tooltip');
    }
  });
});

describe('isExpired', () => {
  const NOW = new Date('2026-04-23T12:00:00Z');

  it('null → false (token never expires)', () => {
    expect(isExpired(null, NOW)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isExpired(undefined, NOW)).toBe(false);
  });

  it('malformed → false (fail-soft, never nukes UI into expiry mode)', () => {
    expect(isExpired('not-a-date', NOW)).toBe(false);
  });

  it('future timestamp → false', () => {
    const future = new Date(NOW.getTime() + 86400_000).toISOString();
    expect(isExpired(future, NOW)).toBe(false);
  });

  it('past timestamp → true', () => {
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    expect(isExpired(past, NOW)).toBe(true);
  });

  it('exactly now → true (boundary is inclusive on the past side)', () => {
    expect(isExpired(NOW.toISOString(), NOW)).toBe(true);
  });
});

describe('sinceIsoRange', () => {
  // Pick a now that's mid-day so "today" midnight is unambiguously earlier.
  const NOW = new Date('2026-04-23T15:30:00Z');

  it('"all" → undefined (caller omits since= query param)', () => {
    expect(sinceIsoRange('all', NOW)).toBeUndefined();
  });

  it('"today" → midnight of the current local day', () => {
    const out = sinceIsoRange('today', NOW);
    // Back to a Date to assert on components — the exact ISO depends on
    // the runner's local timezone, so we check the shape not the string.
    const d = new Date(out!);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    // Must still be <= NOW.
    expect(d.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it('"7d" → exactly 7 × 24h earlier', () => {
    const out = sinceIsoRange('7d', NOW);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() - 7);
    expect(out).toBe(expected.toISOString());
  });

  it('"30d" → exactly 30 × 24h earlier', () => {
    const out = sinceIsoRange('30d', NOW);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() - 30);
    expect(out).toBe(expected.toISOString());
  });
});
