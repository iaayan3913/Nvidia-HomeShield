import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener('change', callback);
    return () => list.removeEventListener('change', callback);
  };
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useMemo(() => subscribeMedia(query), [query]);
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)', true);
/** Roomy enough to keep the case rail, inspector and full camera toolbar open together. */
export const useIsWide = () => useMediaQuery('(min-width: 1280px)', true);
export const useIsRoomyMap = () => useMediaQuery('(min-width: 1280px) and (min-height: 820px)', true);

const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback); window.addEventListener('offline', callback);
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback); };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

export interface WebGLSupport { ok: boolean; reason: string | null; }

/** deck.gl 9 and MapLibre 6 both require WebGL2. `?view=2d` forces the fallback for testing. */
export function detectWebGL(): WebGLSupport {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === '2d') return { ok: false, reason: 'The 2D schematic view was requested in the address (?view=2d).' };
    if (typeof document === 'undefined') return { ok: false, reason: 'No browser document is available.' };
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return { ok: false, reason: 'WebGL2 is unavailable or disabled in this browser, so the 3D twin cannot start.' };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'WebGL could not be initialised in this browser.' };
  }
}

/** Runs a 0→1 progress value for `duration` ms whenever `key` changes (skipped when `enabled` is false). */
export function useTransition(key: string | null, duration: number, enabled: boolean): number {
  const [progress, setProgress] = useState(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!key || !enabled) { setProgress(1); return; }
    let frame = 0; const start = performance.now();
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / duration);
      setProgress(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setProgress(0); frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [key, duration, enabled]);
  return progress;
}

/** Callback-ref element size tracker; returns zero size where ResizeObserver is unavailable. */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) { setSize({ width: 0, height: 0 }); return; }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      const next = { width: Math.round(box.width), height: Math.round(box.height) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, size] as const;
}
