import { describe, expect, it } from 'vitest';
import { GeoDataError, boundsOf, dashSegments, distanceMetres, parseRoads, parseStock, truncatePath, type LonLat } from './geo';
import { parseColor, mix } from './palette';

describe('geojson parsing', () => {
  it('reads metadata and namespaces stock ids', () => {
    const parsed = parseStock({ type: 'FeatureCollection', metadata: { source: 'synthetic', label: 'Synthetic social-housing stock (not real addresses)' }, features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-1.44, 53.4] }, properties: { id: 'p-001', district: 'S4', area: 'Pitsmoor', archetype: 'low_rise_flat', floors: 3 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: ['bad', 53.4] }, properties: {} },
      { type: 'Feature', geometry: null },
    ] });
    expect(parsed.metadata.label).toContain('Synthetic');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]!.id).toBe('stock:p-001');
    expect(parsed.skipped).toBe(2);
  });

  it('rejects malformed collections', () => {
    expect(() => parseRoads({ type: 'Feature' })).toThrow(GeoDataError);
    expect(() => parseStock({ type: 'FeatureCollection', features: [{ geometry: { type: 'Polygon', coordinates: [] } }] })).toThrow(/no valid point/);
  });

  it('keeps road source and attribution', () => {
    const parsed = parseRoads({ type: 'FeatureCollection', metadata: { source: 'osmnx', attribution: '© OpenStreetMap contributors' }, features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-1.5, 53.3], [-1.4, 53.4]] }, properties: { name: 'A61' } },
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[-1.5, 53.3], [-1.45, 53.35]], [[0, 0]]] }, properties: {} },
    ] });
    expect(parsed.metadata).toEqual({ source: 'osmnx', label: 'osmnx', attribution: '© OpenStreetMap contributors' });
    expect(parsed.items).toHaveLength(2);
  });
});

describe('geometry helpers', () => {
  const path: LonLat[] = [[-1.5, 53.38], [-1.49, 53.38], [-1.49, 53.39]];
  it('computes bounds', () => { expect(boundsOf(path)).toEqual([[-1.5, 53.38], [-1.49, 53.39]]); expect(boundsOf([])).toBeNull(); });
  it('truncates paths proportionally', () => {
    expect(truncatePath(path, 1)).toBe(path);
    const half = truncatePath(path, 0.5);
    const total = distanceMetres(path[0]!, path[1]!) + distanceMetres(path[1]!, path[2]!);
    const length = half.slice(1).reduce((sum, p, i) => sum + distanceMetres(half[i]!, p), 0);
    expect(length / total).toBeCloseTo(0.5, 2);
  });
  it('splits dashes along the path', () => {
    const dashes = dashSegments(path, 100, 50);
    expect(dashes.length).toBeGreaterThan(5);
    dashes.slice(0, -1).forEach(([a, b]) => expect(distanceMetres(a, b)).toBeLessThanOrEqual(100.5));
  });
  it('parses token colours', () => {
    expect(parseColor('#d9343b')).toEqual([217, 52, 59]);
    expect(parseColor(' rgb(1, 2, 3) ')).toEqual([1, 2, 3]);
    expect(parseColor('')).toBeNull();
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
  });
});
