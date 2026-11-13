/**
 * Local GeoJSON validation and small geometry helpers for the Sheffield twin.
 * Everything here is pure so it can be unit tested without WebGL.
 */

export type LonLat = [number, number];

export interface CollectionMetadata {
  source: string;
  label: string;
  attribution: string | null;
}

export interface RoadFeature { id: string; name: string; path: LonLat[]; }
export interface StockUnit {
  /** Namespaced id. Stock ids reuse the `p-NNN` pattern of shared fixture properties but are different, unrelated points. */
  id: string;
  sourceId: string;
  position: LonLat;
  district: string;
  area: string;
  archetype: string;
  floors: number;
  bedrooms: number | null;
  builtYear: number | null;
}

export interface ParsedCollection<T> { metadata: CollectionMetadata; items: T[]; skipped: number; }
export type Bounds = [LonLat, LonLat];

export class GeoDataError extends Error {
  constructor(message: string, readonly kind: 'malformed' | 'network' | 'offline' | 'http') { super(message); this.name = 'GeoDataError'; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isLonLat = (value: unknown): value is LonLat => Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

function readCollection(input: unknown, name: string): { metadata: CollectionMetadata; features: unknown[] } {
  if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new GeoDataError(`${name} is not a valid GeoJSON FeatureCollection.`, 'malformed');
  }
  const meta = isRecord(input.metadata) ? input.metadata : {};
  return {
    metadata: {
      source: text(meta.source, 'unknown'),
      label: text(meta.label, text(meta.source, 'Source not stated')),
      attribution: typeof meta.attribution === 'string' && meta.attribution.trim() ? meta.attribution.trim() : null,
    },
    features: input.features,
  };
}

export function parseRoads(input: unknown): ParsedCollection<RoadFeature> {
  const { metadata, features } = readCollection(input, 'Road context');
  const items: RoadFeature[] = []; let skipped = 0;
  features.forEach((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.geometry)) { skipped += 1; return; }
    const { type, coordinates } = feature.geometry;
    const props = isRecord(feature.properties) ? feature.properties : {};
    const lines: unknown[] = type === 'LineString' ? [coordinates] : type === 'MultiLineString' && Array.isArray(coordinates) ? coordinates : [];
    let added = false;
    lines.forEach((line, part) => {
      if (!Array.isArray(line)) return;
      const path = line.filter(isLonLat).map(([lon, lat]) => [lon, lat] as LonLat);
      if (path.length < 2) return;
      items.push({ id: `road-${index}-${part}`, name: text(props.name, 'Unnamed link'), path });
      added = true;
    });
    if (!added) skipped += 1;
  });
  return { metadata, items, skipped };
}

export function parseStock(input: unknown): ParsedCollection<StockUnit> {
  const { metadata, features } = readCollection(input, 'Housing stock');
  const items: StockUnit[] = []; let skipped = 0;
  features.forEach((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.geometry) || feature.geometry.type !== 'Point' || !isLonLat(feature.geometry.coordinates)) { skipped += 1; return; }
    const props = isRecord(feature.properties) ? feature.properties : {};
    const [lon, lat] = feature.geometry.coordinates;
    const sourceId = text(props.id ?? feature.id, `unit-${index + 1}`);
    const floors = isFiniteNumber(props.floors) && props.floors > 0 ? Math.min(Math.round(props.floors), 40) : 1;
    items.push({
      id: `stock:${sourceId}`,
      sourceId,
      position: [lon, lat],
      district: text(props.district, 'Unknown district'),
      area: text(props.area, 'Unknown area'),
      archetype: text(props.archetype, 'unknown'),
      floors,
      bedrooms: isFiniteNumber(props.bedrooms) ? props.bedrooms : null,
      builtYear: isFiniteNumber(props.built_year) ? props.built_year : null,
    });
  });
  if (!items.length && features.length) throw new GeoDataError('Housing stock contains no valid point features.', 'malformed');
  return { metadata, items, skipped };
}

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

/** Great-circle distance in metres. */
export function distanceMetres(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]); const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

const lerp = (a: LonLat, b: LonLat, t: number): LonLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Return the leading fraction (0–1) of a polyline, used for the approved-route draw-in transition. */
export function truncatePath(path: LonLat[], fraction: number): LonLat[] {
  if (fraction >= 1 || path.length < 2) return path;
  if (fraction <= 0) return [path[0]!, path[0]!];
  const lengths = path.slice(1).map((point, i) => distanceMetres(path[i]!, point));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let remaining = total * fraction; const out: LonLat[] = [path[0]!];
  for (let i = 0; i < lengths.length; i += 1) {
    const segment = lengths[i]!;
    if (remaining >= segment) { out.push(path[i + 1]!); remaining -= segment; continue; }
    out.push(lerp(path[i]!, path[i + 1]!, segment ? remaining / segment : 0));
    break;
  }
  return out.length < 2 ? [path[0]!, path[0]!] : out;
}

/**
 * Split a schematic polyline into dash segments so pending routes read as unmistakably different from approved ones
 * (deck.gl's dash extension is not a shared dependency).
 */
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
      const start = lerp(a, b, travelled / length); const end = lerp(a, b, (travelled + step) / length);
      if (drawing) out.push([start, end]);
      travelled += step; carry -= step;
      if (carry <= 1e-6) { drawing = !drawing; carry = drawing ? dashMetres : gapMetres; }
    }
    if (out.length > 4000) break;
  }
  return out;
}

/** Approximate metres per screen pixel for web-mercator zoom at a latitude. */
export const metresPerPixel = (zoom: number, latitude: number) => (156_543.033_92 * Math.cos(rad(latitude))) / 2 ** zoom;
