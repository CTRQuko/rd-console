import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime } from './formatters';

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
