import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_PREFS, usePrefs, applyPrefsToDom } from './prefsStore';

afterEach(() => {
  localStorage.clear();
  const html = document.documentElement;
  ['data-accent', 'data-density', 'data-radius', 'data-sidebar'].forEach((a) =>
    html.removeAttribute(a),
  );
  html.style.removeProperty('--rd-font-scale');
});

describe('usePrefs', () => {
  it('seeds from defaults when localStorage is empty', () => {
    const { result } = renderHook(() => usePrefs());
    const [prefs] = result.current;
    // Accent + fontScale come from hard defaults.
    expect(prefs.accent).toBe(DEFAULT_PREFS.accent);
    expect(prefs.fontScale).toBe(DEFAULT_PREFS.fontScale);
    // General fields also default-populated (landingPage/dateTimeFormat/
    // timezone are fixed; language depends on navigator.language).
    expect(prefs.landingPage).toBe('/');
    expect(prefs.dateTimeFormat).toBe('system');
    expect(prefs.timezone).toBe('browser');
    expect(['es', 'en', 'fr', 'de', 'pt']).toContain(prefs.language);
  });

  it('applies accent + font-scale to the DOM on mount', () => {
    renderHook(() => usePrefs());
    expect(document.documentElement.getAttribute('data-accent')).toBe('blue');
    // Legacy attrs stay cleared.
    expect(document.documentElement.getAttribute('data-density')).toBeNull();
    expect(document.documentElement.getAttribute('data-radius')).toBeNull();
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });

  it('persists v7 General fields and they round-trip through localStorage', () => {
    const { result } = renderHook(() => usePrefs());
    act(() =>
      result.current[1]({
        landingPage: '/devices',
        language: 'es',
        dateTimeFormat: 'eu',
        timezone: 'Europe/Madrid',
      }),
    );
    const stored = JSON.parse(localStorage.getItem('rd:prefs') ?? '{}');
    expect(stored.landingPage).toBe('/devices');
    expect(stored.language).toBe('es');
    expect(stored.dateTimeFormat).toBe('eu');
    expect(stored.timezone).toBe('Europe/Madrid');
  });

  it('rejects bogus General values and falls back to defaults', () => {
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({
        landingPage: '/tags', // removed in v6
        language: 'klingon',
        dateTimeFormat: 'fancy',
        timezone: 'Not/AZone',
      }),
    );
    const { result } = renderHook(() => usePrefs());
    const [prefs] = result.current;
    expect(prefs.landingPage).toBe('/');
    // language default depends on browser; it's just NOT `klingon`.
    expect(['es', 'en', 'fr', 'de', 'pt']).toContain(prefs.language);
    expect(prefs.dateTimeFormat).toBe('system');
    expect(prefs.timezone).toBe('browser');
  });

  it('accepts well-formed IANA timezone strings not in the preset list', () => {
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({ timezone: 'Pacific/Auckland' }),
    );
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0].timezone).toBe('Pacific/Auckland');
  });

  it('ignores legacy density/radius/sidebarStyle keys from pre-v6 blobs', () => {
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({
        accent: 'rose',
        density: 'compact',
        radius: '12',
        sidebarStyle: 'follow-theme',
        fontScale: 1.05,
      }),
    );
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0].accent).toBe('rose');
    expect(result.current[0].fontScale).toBe(1.05);
  });

  it('reset() restores defaults', () => {
    const { result } = renderHook(() => usePrefs());
    act(() => result.current[1]({ accent: 'teal', dateTimeFormat: 'us' }));
    expect(result.current[0].accent).toBe('teal');
    act(() => result.current[2]());
    // Language depends on navigator but all other fields are back to hard defaults.
    expect(result.current[0].accent).toBe(DEFAULT_PREFS.accent);
    expect(result.current[0].dateTimeFormat).toBe('system');
  });

  it('font scale sets the --rd-font-scale CSS variable', () => {
    const { result } = renderHook(() => usePrefs());
    act(() => result.current[1]({ fontScale: 1.1 }));
    expect(document.documentElement.style.getPropertyValue('--rd-font-scale')).toBe(
      '1.1',
    );
  });
});

describe('applyPrefsToDom', () => {
  it('writes accent + font-scale, clears legacy attrs', () => {
    document.documentElement.setAttribute('data-density', 'compact');
    document.documentElement.setAttribute('data-radius', '12');
    document.documentElement.setAttribute('data-sidebar', 'follow-theme');

    applyPrefsToDom({
      accent: 'teal',
      fontScale: 1,
      landingPage: '/',
      language: 'en',
      dateTimeFormat: 'system',
      timezone: 'browser',
    });

    expect(document.documentElement.getAttribute('data-accent')).toBe('teal');
    expect(document.documentElement.getAttribute('data-density')).toBeNull();
    expect(document.documentElement.getAttribute('data-radius')).toBeNull();
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });
});
