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
    expect(document.documentElement.getAttribute('data-density')).toBe('normal');
    expect(document.documentElement.getAttribute('data-radius')).toBe('6');
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('always-dark');
  });

  it('persists updates and reflects them in the DOM', () => {
    const { result } = renderHook(() => usePrefs());
    act(() => result.current[1]({ accent: 'violet', density: 'compact' }));
    expect(result.current[0].accent).toBe('violet');
    expect(result.current[0].density).toBe('compact');
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet');
    const stored = JSON.parse(localStorage.getItem('rd:prefs') ?? '{}');
    expect(stored.accent).toBe('violet');
  });

  it('rejects bogus values from localStorage and falls back to defaults', () => {
    localStorage.setItem(
      'rd:prefs',
      JSON.stringify({ accent: 'pink', density: 'tight', fontScale: 99 }),
    );
    const { result } = renderHook(() => usePrefs());
    expect(result.current[0]).toEqual(DEFAULT_PREFS);
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
  it('idempotently writes every data-attribute', () => {
    applyPrefsToDom({
      accent: 'teal',
      density: 'comfortable',
      radius: '12',
      fontScale: 1,
      sidebarStyle: 'follow-theme',
    });
    expect(document.documentElement.getAttribute('data-accent')).toBe('teal');
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
    expect(document.documentElement.getAttribute('data-radius')).toBe('12');
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('follow-theme');
  });
});
