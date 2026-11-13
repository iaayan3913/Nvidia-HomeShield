/** Pan/zoom maths for the 2D fallback: a web-mercator view centred on (cx, cy) at `scale` pixels per mercator unit. */
import { mercator, type Bounds, type LonLat } from './geo';

export interface View2D { cx: number; cy: number; scale: number; }
export const MIN_SCALE = 2 ** 10 * 256;   // ≈ zoom 10
export const MAX_SCALE = 2 ** 19 * 256;   // ≈ zoom 19

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function toScreen(point: [number, number], view: View2D, width: number, height: number): [number, number] {
  return [(point[0] - view.cx) * view.scale + width / 2, (point[1] - view.cy) * view.scale + height / 2];
}
export function toWorld(x: number, y: number, view: View2D, width: number, height: number): [number, number] {
  return [view.cx + (x - width / 2) / view.scale, view.cy + (y - height / 2) / view.scale];
}
export const projectLonLat = (point: LonLat, view: View2D, width: number, height: number) => toScreen(mercator(point), view, width, height);

/** Pan by a screen-space delta (drag direction). */
export const panBy = (view: View2D, dx: number, dy: number): View2D => ({ ...view, cx: view.cx - dx / view.scale, cy: view.cy - dy / view.scale });

/** Zoom by `factor`, keeping the screen point (x, y) fixed under the cursor. */
export function zoomAt(view: View2D, factor: number, x: number, y: number, width: number, height: number): View2D {
  const scale = clampScale(view.scale * factor);
  const [wx, wy] = toWorld(x, y, view, width, height);
  return { scale, cx: wx - (x - width / 2) / scale, cy: wy - (y - height / 2) / scale };
}

export function fitView(bounds: Bounds, width: number, height: number, padding = 40): View2D {
  const [x0, y1] = mercator(bounds[0]); const [x1, y0] = mercator(bounds[1]);
  const spanX = Math.max(x1 - x0, 1e-7); const spanY = Math.max(y1 - y0, 1e-7);
  const scale = clampScale(Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale };
}

export const viewAt = (center: LonLat, zoom: number): View2D => { const [cx, cy] = mercator(center); return { cx, cy, scale: clampScale(2 ** zoom * 256) }; };
export const zoomOf = (view: View2D) => Math.log2(view.scale / 256);
