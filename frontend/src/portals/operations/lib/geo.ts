/**
 * Geometry helpers for the Sheffield twin: local GeoJSON validation, building footprints and heights,
 * case-to-building matching, hexagon binning and path utilities. Pure functions, unit tested.
 */

export type LonLat = [number, number];
export type Ring = LonLat[];
export type Bounds = [LonLat, LonLat];

export interface CollectionMetadata { source: string; label: string; attribution: string | null; }
export interface LocalCollection { metadata: CollectionMetadata; features: GeoFeature[]; skipped: number; }
export interface GeoFeature { id: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown>; }

export class GeoDataError extends Error {
  constructor(message: string, readonly kind: 'malformed' | 'network' | 'offline' | 'http') { super(message); this.name = 'GeoDataError'; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isLonLat = (value: unknown): value is LonLat => Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

/** Validate a FeatureCollection, keeping only features whose geometry type is allowed. */
export function parseCollection(input: unknown, name: string, allowed: string[]): LocalCollection {
  if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new GeoDataError(`${name} is not a valid GeoJSON FeatureCollection.`, 'malformed');
  }
  const meta = isRecord(input.metadata) ? input.metadata : {};
  const features: GeoFeature[] = []; let skipped = 0;
  input.features.forEach((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.geometry) || typeof feature.geometry.type !== 'string' || !allowed.includes(feature.geometry.type) || !Array.isArray(feature.geometry.coordinates)) { skipped += 1; return; }
    features.push({ id: String(feature.id ?? index), geometry: { type: feature.geometry.type, coordinates: feature.geometry.coordinates }, properties: isRecord(feature.properties) ? feature.properties : {} });
  });
  return {
    metadata: { source: text(meta.source, 'unknown'), label: text(meta.label, name), attribution: typeof meta.attribution === 'string' && meta.attribution.trim() ? meta.attribution.trim() : null },
    features, skipped,
  };
}

/* ---------------------------------------------------------------- buildings */

export const STOREY_METRES = 3;
export const DEFAULT_BUILDING_HEIGHT = 6;

const numeric = (value: unknown): number | null => {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return null;
  const match = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(value.split(';')[0] ?? '');
  return match ? Number(match[1]!.replace(',', '.')) : null;
};

/** Building height in metres: render_height (tiles) → height → levels × 3 m → 6 m. Never zoom dependent. */
export function buildingHeight(props: Record<string, unknown>): { height: number; base: number } {
  const height = numeric(props.render_height) ?? numeric(props.height)
    ?? (numeric(props.levels) ?? numeric(props['building:levels'])) ?? null;
  const fromLevels = numeric(props.render_height) === null && numeric(props.height) === null && height !== null;
  const metres = height === null || height <= 0 ? DEFAULT_BUILDING_HEIGHT : fromLevels ? height * STOREY_METRES : height;
  const base = numeric(props.render_min_height) ?? numeric(props.min_height) ?? 0;
  return { height: metres, base: Math.max(0, Math.min(base, metres - 0.5)) };
}

/** Outer rings of a Polygon or MultiPolygon geometry. */
export function outerRings(geometry: { type: string; coordinates: unknown }): Ring[] {
  const valid = (ring: unknown): ring is Ring => Array.isArray(ring) && ring.length >= 4 && ring.every(isLonLat);
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) return valid(geometry.coordinates[0]) ? [geometry.coordinates[0] as Ring] : [];
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) return (geometry.coordinates as unknown[]).map((poly) => (Array.isArray(poly) ? poly[0] : null)).filter(valid);
  return [];
}

export function pointInRing([x, y]: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance in metres from a point to a ring's boundary (equirectangular, accurate at building scale). */
export function distanceToRing(point: LonLat, ring: Ring): number {
  const k = Math.cos((point[1] * Math.PI) / 180) * 111_320; const m = 110_574;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = (ring[i]![0] - point[0]) * k, ay = (ring[i]![1] - point[1]) * m;
    const bx = (ring[i + 1]![0] - point[0]) * k, by = (ring[i + 1]![1] - point[1]) * m;
    const dx = bx - ax, dy = by - ay; const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export interface Footprint { ring: Ring; height: number; base: number; }
export interface FootprintMatch extends Footprint { quality: 'inside' | 'nearest'; distance: number; }
export const NEAREST_BUILDING_METRES = 40;

/** Match a reported location to the building that contains it, or the nearest one within 40 m. */
export function matchFootprint(point: LonLat, candidates: Iterable<Footprint>, maxDistance = NEAREST_BUILDING_METRES): FootprintMatch | null {
  let nearest: FootprintMatch | null = null;
  for (const candidate of candidates) {
    if (pointInRing(point, candidate.ring)) return { ...candidate, quality: 'inside', distance: 0 };
    const distance = distanceToRing(point, candidate.ring);
    if (distance <= maxDistance && (!nearest || distance < nearest.distance)) nearest = { ...candidate, quality: 'nearest', distance };
  }
  return nearest;
}

/** Simple bounding-box grid so case matching against tens of thousands of footprints stays fast. */
export class FootprintIndex {
  private cells = new Map<string, Footprint[]>();
  constructor(footprints: Footprint[], private cell = 0.002) {
    for (const footprint of footprints) {
      const [[minX, minY], [maxX, maxY]] = boundsOf(footprint.ring)!;
      for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x += 1)
        for (let y = Math.floor(minY / cell); y <= Math.floor(maxY / cell); y += 1) {
          const key = `${x}:${y}`; const list = this.cells.get(key) ?? []; list.push(footprint); this.cells.set(key, list);
        }
    }
  }
  near([lon, lat]: LonLat): Footprint[] {
    const cx = Math.floor(lon / this.cell); const cy = Math.floor(lat / this.cell); const out = new Set<Footprint>();
    for (let x = cx - 1; x <= cx + 1; x += 1) for (let y = cy - 1; y <= cy + 1; y += 1) this.cells.get(`${x}:${y}`)?.forEach((f) => out.add(f));
    return [...out];
  }
}

export function footprintsFrom(features: GeoFeature[]): Footprint[] {
  return features.flatMap((feature) => { const { height, base } = buildingHeight(feature.properties); return outerRings(feature.geometry).map((ring) => ({ ring, height, base })); });
}

/** Grow a ring slightly about its centroid so a highlight shell covers the basemap extrusion without z-fighting. */
export function inflateRing(ring: Ring, factor: number): Ring {
  const n = ring.length - 1 || 1;
  const cx = ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n; const cy = ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n;
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as LonLat);
}

/** Regular polygon around a point with a radius in metres — used for hazard columns and markers. */
export function circleRing([lon, lat]: LonLat, radiusMetres: number, sides = 16): Ring {
  const dLat = radiusMetres / 110_574; const dLon = radiusMetres / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: sides }, (_, i) => { const a = (2 * Math.PI * i) / sides; return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] as LonLat; });
  return [...ring, ring[0]!];
}

/* ---------------------------------------------------------------- hexagon density */

export interface HexBin { id: string; center: LonLat; count: number; ring: Ring; }

/** Pointy-top hexagon binning in local metres around `origin`. */
export function hexBin(points: LonLat[], radiusMetres: number, origin: LonLat): HexBin[] {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180); const ky = 110_574;
  const size = radiusMetres; const bins = new Map<string, { q: number; r: number; count: number }>();
  for (const [lon, lat] of points) {
    const x = (lon - origin[0]) * kx; const y = (lat - origin[1]) * ky;
    const qf = ((Math.sqrt(3) / 3) * x - y / 3) / size; const rf = ((2 / 3) * y) / size; const sf = -qf - rf;
    let q = Math.round(qf), r = Math.round(rf); const s = Math.round(sf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const key = `${q}:${r}`; const bin = bins.get(key) ?? { q, r, count: 0 }; bin.count += 1; bins.set(key, bin);
  }
  return [...bins.entries()].map(([key, { q, r, count }]) => {
    const cx = size * Math.sqrt(3) * (q + r / 2); const cy = size * 1.5 * r;
    const toLonLat = (x: number, y: number): LonLat => [origin[0] + x / kx, origin[1] + y / ky];
    const ring = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 30); return toLonLat(cx + size * Math.cos(a), cy + size * Math.sin(a)); });
    return { id: key, center: toLonLat(cx, cy), count, ring: [...ring, ring[0]!] };
  });
}

/* ---------------------------------------------------------------- general */

export function boundsOf(points: Iterable<LonLat>): Bounds | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  return Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null;
}

const EARTH_RADIUS = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;
export function distanceMetres(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]); const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Leading fraction (0–1) of a polyline, for the approved-route draw-in. */
export function truncatePath(path: LonLat[], fraction: number): LonLat[] {
  if (fraction >= 1 || path.length < 2) return path;
  if (fraction <= 0) return [path[0]!, path[0]!];
  const lengths = path.slice(1).map((point, i) => distanceMetres(path[i]!, point));
  let remaining = lengths.reduce((s, v) => s + v, 0) * fraction; const out: LonLat[] = [path[0]!];
  for (let i = 0; i < lengths.length; i += 1) {
    const segment = lengths[i]!;
    if (remaining >= segment) { out.push(path[i + 1]!); remaining -= segment; continue; }
    out.push(lerp(path[i]!, path[i + 1]!, segment ? remaining / segment : 0)); break;
  }
  return out.length < 2 ? [path[0]!, path[0]!] : out;
}

/** Morph between two polylines (re-plan animation): resample both to the same vertex count and interpolate. */
export function morphPath(from: LonLat[], to: LonLat[], t: number, samples = 24): LonLat[] {
  if (t >= 1 || from.length < 2) return to;
  const resample = (path: LonLat[]) => Array.from({ length: samples }, (_, i) => { const p = truncatePath(path, i / (samples - 1)); return p[p.length - 1]!; });
  const a = resample(from); const b = resample(to);
  return a.map((point, i) => lerp(point, b[i]!, t));
}

/** Dash pieces for pending routes (no dash extension dependency). */
export function dashSegments(path: LonLat[], dashMetres: number, gapMetres: number): Array<[LonLat, LonLat]> {
  const out: Array<[LonLat, LonLat]> = [];
  if (dashMetres <= 0 || path.length < 2) return out;
  let drawing = true; let carry = dashMetres;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!; const b = path[i + 1]!; const length = distanceMetres(a, b);
    if (!length) continue;
    let travelled = 0;
    while (travelled < length) {
      const step = Math.min(carry, length - travelled);
      if (drawing) out.push([lerp(a, b, travelled / length), lerp(a, b, (travelled + step) / length)]);
      travelled += step; carry -= step;
      if (carry <= 1e-6) { drawing = !drawing; carry = drawing ? dashMetres : gapMetres; }
    }
    if (out.length > 4000) break;
  }
  return out;
}

export const metresPerPixel = (zoom: number, latitude: number) => (156_543.033_92 * Math.cos(rad(latitude))) / 2 ** zoom;

/* ---------------------------------------------------------------- web mercator (2D fallback) */

export const mercator = ([lon, lat]: LonLat): [number, number] => {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(rad(clamped)) + 1 / Math.cos(rad(clamped))) / Math.PI) / 2];
};
