/**
 * Map and deck.gl colours are read at runtime from CSS custom properties (see operations.css),
 * so this file and every component stay free of colour literals. Re-read whenever data-theme changes.
 */
import type { HazardType, Severity } from '../../../shared/types/domain';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

const NEUTRAL: RGB = [128, 128, 128];

export function parseColor(value: string | null | undefined): RGB | null {
  const input = value?.trim().toLowerCase();
  if (!input) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(input)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(input)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) return parts.map((v) => Math.round(v)) as RGB;
  }
  // color(srgb r g b) — what browsers return for resolved color-mix() values.
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(input)?.[1];
  if (srgb) {
    const parts = srgb.split(/[\s/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) return parts.map((v) => Math.round(v * 255)) as RGB;
  }
  return null;
}

export const mix = (a: RGB, b: RGB, amount: number): RGB => a.map((value, i) => Math.round(value + (b[i]! - value) * amount)) as RGB;
export const withAlpha = (color: RGB, alpha: number): RGBA => [color[0], color[1], color[2], Math.round(alpha)];
export const css = (color: RGB, alpha = 1) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

export interface MapPalette {
  theme: 'light' | 'dark';
  land: RGB; water: RGB; park: RGB; roadMajor: RGB; road: RGB; roadMinor: RGB; roadCasing: RGB; rail: RGB;
  building: RGB; buildingEdge: RGB; label: RGB; labelHalo: RGB;
  severity: Record<Severity, RGB>; hazard: Record<HazardType, RGB>;
  selected: RGB; active: RGB; proposed: RGB; operative: RGB; operativeIdle: RGB; ink: RGB; canvas: RGB; density: RGB;
}

/**
 * Custom properties are resolved through a probe element because getPropertyValue() returns the raw
 * declaration (e.g. "color-mix(...)") rather than a computed colour.
 */
export function readPalette(element: Element | null): MapPalette {
  const root = (element as HTMLElement | null) ?? (typeof document !== 'undefined' ? document.documentElement : null);
  const probe = root && typeof document !== 'undefined' ? document.createElement('span') : null;
  if (probe && root) { probe.style.display = 'none'; root.appendChild(probe); }
  const token = (name: string): RGB => {
    if (!probe || typeof getComputedStyle !== 'function') return NEUTRAL;
    probe.style.color = `var(${name})`;
    return parseColor(getComputedStyle(probe).color) ?? NEUTRAL;
  };
  const theme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const palette: MapPalette = {
    theme,
    land: token('--map-land'), water: token('--map-water'), park: token('--map-park'),
    roadMajor: token('--map-road-major'), road: token('--map-road'), roadMinor: token('--map-road-minor'), roadCasing: token('--map-road-casing'), rail: token('--map-rail'),
    building: token('--map-building'), buildingEdge: token('--map-building-edge'), label: token('--map-label'), labelHalo: token('--map-label-halo'),
    severity: { emergency: token('--map-severity-emergency'), significant: token('--map-severity-significant'), moderate: token('--map-severity-moderate'), routine: token('--map-severity-routine') },
    hazard: { damp_mould: token('--map-hazard-damp'), leak: token('--map-hazard-leak'), electrical: token('--map-hazard-electrical'), gas: token('--map-hazard-gas'), fire: token('--map-hazard-fire'), other: token('--map-hazard-other') },
    selected: token('--map-selected'), active: token('--map-route-active'), proposed: token('--map-route-proposed'),
    operative: token('--map-operative'), operativeIdle: token('--map-operative-idle'), ink: token('--ink-900'), canvas: token('--map-land'), density: token('--map-density'),
  };
  probe?.remove();
  return palette;
}
