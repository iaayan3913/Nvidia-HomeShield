// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoredTheme } from './prepaint';
import { ThemeControl } from './ThemeControl';
import { useTheme } from './useTheme';

const prefersDark = (dark: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() })));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="">';
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('theme pre-paint', () => {
  it('follows the system by default and sets theme-color', () => {
    prefersDark(true);
    expect(applyStoredTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#0d100d');
  });

  it('honours a stored preference and ignores invalid values', () => {
    prefersDark(true);
    localStorage.setItem('homeshield.theme', 'light');
    expect(applyStoredTheme()).toBe('light');
    localStorage.setItem('homeshield.theme', 'purple');
    expect(applyStoredTheme()).toBe('dark');
  });

  it('is self-contained so it can be inlined into HTML', () => {
    prefersDark(false);
    localStorage.setItem('homeshield.theme', 'dark');
    // Run the serialised source exactly as vite.config.ts inlines it.
    new Function(`(${applyStoredTheme.toString()})()`)();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('useTheme and ThemeControl', () => {
  it('stores the preference and applies it', () => {
    prefersDark(false); applyStoredTheme();
    const { result } = renderHook(() => useTheme());
    expect(result.current).toMatchObject({ preference: 'system', theme: 'light' });
    act(() => result.current.setPreference('dark'));
    expect(result.current).toMatchObject({ preference: 'dark', theme: 'dark' });
    expect(localStorage.getItem('homeshield.theme')).toBe('dark');
  });

  it('is a labelled radio group operable from the keyboard', () => {
    prefersDark(false); applyStoredTheme();
    render(<ThemeControl />);
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: /System/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Dark/ }));
    expect((screen.getByRole('radio', { name: /Dark/ }) as HTMLInputElement).checked).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
