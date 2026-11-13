/**
 * Sets `<html data-theme>` and `<meta name="theme-color">` from `localStorage['homeshield.theme']`.
 * vite.config.ts inlines this function into every HTML entry so it runs before first paint, and
 * `useTheme` calls it after a change. It must stay self-contained (no imports or outer references).
 */
export function applyStoredTheme(): 'light' | 'dark' {
  let preference = 'system';
  try {
    const stored = window.localStorage.getItem('homeshield.theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored;
  } catch { /* storage blocked: follow the system */ }
  const prefersDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = preference === 'dark' || (preference === 'system' && prefersDark) ? 'dark' : 'light';
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d100d' : '#f6f7f3');
  return theme;
}
