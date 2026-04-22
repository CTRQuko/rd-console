import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './themeStore';

describe('useTheme', () => {
  it('defaults to light when nothing is stored and prefers-color-scheme is light', () => {
    const { result } = renderHook(() => useTheme());
    const [theme] = result.current;
    expect(theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle flips theme and applies the dark class to <html>', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[2]()); // toggle
    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => result.current[2]());
    expect(result.current[0]).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists the theme choice to rd:theme', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('dark'));
    expect(localStorage.getItem('rd:theme')).toBe('dark');
  });
});
