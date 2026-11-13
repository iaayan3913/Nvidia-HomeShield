/**
 * deck.gl needs numeric colours, but colour values must live only in the global tokens.
 * This reads the CSS custom properties at runtime and derives map colours from them.
 */
import type { Severity } from '../../../shared/types/domain';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

const NEUTRAL: RGB = [128, 128, 128];
const WHITE: RGB = [255, 255, 255];

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
    if (parts.length === 3 && parts.every(Number.isFinite)) return parts as RGB;
  }
  return null;
}

export const mix = (a: RGB, b: RGB, amount: number): RGB => a.map((value, i) => Math.round(value + (b[i]! - value) * amount)) as RGB;
export const withAlpha = (color: RGB, alpha: number): RGBA => [color[0], color[1], color[2], Math.round(alpha)];

export interface MapPalette {
  background: string;
  road: RGB; stock: RGB; stockEdge: RGB;
  severity: Record<Severity, RGB>;
  selected: RGB; active: RGB; proposed: RGB; worker: RGB; workerIdle: RGB; ink: RGB; canvas: RGB;
}

export function readPalette(element: Element | null): MapPalette {
  const style = element && typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  const token = (name: string) => parseColor(style?.getPropertyValue(name)) ?? NEUTRAL;
  const canvas = token('--graphite-950');
  const danger = token('--danger');
  const warning = token('--warning');
  const info = token('--info');
  const ink = token('--ink-900');
  const muted = token('--ink-500');
  return {
    background: style?.getPropertyValue('--graphite-950').trim() || 'black',
    canvas,
    road: token('--border-strong'),
    stock: mix(token('--graphite-700'), WHITE, 0.08),
    stockEdge: token('--graphite-700'),
    // Brighten semantic tokens slightly so they hold contrast on the graphite canvas; hue stays identical.
    severity: { emergency: mix(danger, WHITE, 0.08), significant: mix(warning, WHITE, 0.3), moderate: mix(warning, WHITE, 0.62), routine: muted },
    selected: token('--green-500'),
    active: mix(info, WHITE, 0.32),
    proposed: mix(warning, WHITE, 0.42),
    worker: ink,
    workerIdle: muted,
    ink,
  };
}
