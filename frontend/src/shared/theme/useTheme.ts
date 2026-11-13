import { useCallback, useSyncExternalStore } from 'react';
import { applyStoredTheme } from './prepaint';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_KEY = 'homeshield.theme';

const listeners = new Set<() => void>();
const notify = () => { applyStoredTheme(); listeners.forEach((listener) => listener()); };

function readPreference(): ThemePreference {
  try { const stored = localStorage.getItem(THEME_KEY); return stored === 'light' || stored === 'dark' ? stored : 'system'; }
  catch { return 'system'; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onStorage = (event: StorageEvent) => { if (event.key === THEME_KEY) notify(); };
  media?.addEventListener('change', notify);
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); media?.removeEventListener('change', notify); window.removeEventListener('storage', onStorage); };
}

// A string snapshot keeps useSyncExternalStore stable between renders.
const snapshot = () => `${readPreference()}:${document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'}`;

/** Current theme, stored preference and a setter. Other tabs follow via the storage event. */
export function useTheme(): { theme: 'light' | 'dark'; preference: ThemePreference; setPreference(preference: ThemePreference): void } {
  const [preference, theme] = useSyncExternalStore(subscribe, snapshot, () => 'system:light').split(':') as [ThemePreference, 'light' | 'dark'];
  const setPreference = useCallback((next: ThemePreference) => {
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: the choice cannot be kept, so the system theme stays */ }
    notify();
  }, []);
  return { theme, preference, setPreference };
}
