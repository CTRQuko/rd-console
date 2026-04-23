import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_PREFS, usePrefs, applyPrefsToDom } from './prefsStore';

afterEach(() => {
  localStorage.clear();
  // Clean DOM attributes so one test doesn't bleed into the next.
  const html = document.documentElement;
  ['data-accent', 'data-density', 'data-radius', 'data-sidebar'].forEach((a) =>
    html.removeAttribute(a),
  );
  html.style.removeProperty('--rd-font-scale');
});

describe('usePrefs', () => {
  it('seeds from defaults when localStorage is empty', () => {
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
  });

  it('applies prefs to the <html> data-attributes on mount', () => {
    renderHook(() => usePrefs());
    expect(document.documentElement.getAttribute('data-accent')).toBe('blue');
    // density / radius / sidebar were removed in P4/P6 — should NOT be
    // present.
    expect(document.documentElement.getAttribute('data-density')).toBeNull();
    expect(document.documentElement.getAttribute('data-radius')).toBeNull();
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });

  it('persists accent updates and reflects them in the DOM', () => {
    const { result } = renderHook(() => usePrefs());
    act(() => result.current[1]({ accent: 'violet' }));
    expect(result.current[0].accent).toBe('violet');
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet');
    const stored = JSON.parse(localStorage.getItem('rd:prefs') ?? '{}');
    expect(stored.accent).toBe('violet');
  });

  it('rejects bogus values from localStorage and falls back to defaults', () => {
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({ accent: 'pink', fontScale: 99 }),
    );
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
  });

  it('ignores legacy density / radius / sidebarStyle keys from older blobs', () => {
    // A PR #30 / P4 browser would have these keys. After P6-A they are
    // ignored: valid prefs still come through, the dead keys don't leak
    // into state.
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({
        accent: 'rose',
        density: 'compact',
        radius: '12',
        fontScale: 1.05,
        sidebarStyle: 'follow-theme',
      }),
    );
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0]).toEqual({
      accent: 'rose',
      fontScale: 1.05,
    });
    // DOM gets only the attrs we still support.
    expect(document.documentElement.getAttribute('data-density')).toBeNull();
    expect(document.documentElement.getAttribute('data-radius')).toBeNull();
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });

  it('reset() restores defaults', () => {
    const { result } = renderHook(() => usePrefs());
    act(() => result.current[1]({ accent: 'rose', fontScale: 1.15 }));
    expect(result.current[0].accent).toBe('rose');
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
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
    // Pre-seed the dead legacy attributes to verify they get stripped.
    document.documentElement.setAttribute('data-density', 'compact');
    document.documentElement.setAttribute('data-radius', '12');
    document.documentElement.setAttribute('data-sidebar', 'follow-theme');

    applyPrefsToDom({
      accent: 'teal',
      fontScale: 1,
    });

    expect(document.documentElement.getAttribute('data-accent')).toBe('teal');
    // Legacy keys wiped.
    expect(document.documentElement.getAttribute('data-density')).toBeNull();
    expect(document.documentElement.getAttribute('data-radius')).toBeNull();
    expect(document.documentElement.getAttribute('data-sidebar')).toBeNull();
  });
});
