import { describe, expect, it } from 'vitest';
import {
  FootprintIndex, GeoDataError, boundsOf, buildingHeight, circleRing, dashSegments, distanceMetres, distanceToRing, footprintsFrom, hexBin,
  matchFootprint, morphPath, parseCollection, pointInRing, truncatePath, type LonLat, type Ring,
} from './geo';
import { mix, parseColor } from './palette';
import { fitView, panBy, toScreen, toWorld, viewAt, zoomAt, zoomOf } from './view2d';

// A ~20 m square building near Sheffield Town Hall.
const square: Ring = [[-1.4705, 53.3805], [-1.4702, 53.3805], [-1.4702, 53.3807], [-1.4705, 53.3807], [-1.4705, 53.3805]];

describe('local GeoJSON', () => {
  it('validates collections and drops unsupported geometry', () => {
    const parsed = parseCollection({ type: 'FeatureCollection', metadata: { source: 'openfreemap-openmaptiles', label: 'Buildings', attribution: '© OpenStreetMap contributors' }, features: [
      { type: 'Feature', id: 'a', geometry: { type: 'Polygon', coordinates: [square] }, properties: { height: 12 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', geometry: null },
    ] }, 'Buildings', ['Polygon', 'MultiPolygon']);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
    expect(parsed.metadata.attribution).toContain('OpenStreetMap');
  });
  it('rejects malformed collections', () => {
    expect(() => parseCollection({ type: 'Feature' }, 'Roads', ['LineString'])).toThrow(GeoDataError);
  });
});

describe('building heights are metric and never zoom dependent', () => {
  it('prefers render_height, then height, then levels × 3 m, then 6 m', () => {
    expect(buildingHeight({ render_height: 24, render_min_height: 3 })).toEqual({ height: 24, base: 3 });
    expect(buildingHeight({ height: '15.5 m' }).height).toBe(15.5);
    expect(buildingHeight({ levels: 4 }).height).toBe(12);
    expect(buildingHeight({ 'building:levels': '2' }).height).toBe(6);
    expect(buildingHeight({}).height).toBe(6);
  });
});

describe('case-to-building matching', () => {
  const footprints = footprintsFrom([{ id: 'b', geometry: { type: 'Polygon', coordinates: [square] }, properties: { height: 18 } }]);
  it('matches a point inside a footprint', () => {
    const match = matchFootprint([-1.47035, 53.3806], footprints);
    expect(match?.quality).toBe('inside');
    expect(match?.height).toBe(18);
  });
  it('matches the nearest footprint within 40 m, otherwise nothing', () => {
    const near: LonLat = [-1.4705 - 0.0003, 53.3806]; // ~20 m west
    expect(matchFootprint(near, footprints)?.quality).toBe('nearest');
    expect(distanceToRing(near, square)).toBeGreaterThan(15);
    expect(matchFootprint([-1.48, 53.39], footprints)).toBeNull();
  });
  it('indexes footprints spatially', () => {
    const index = new FootprintIndex(footprints);
    expect(index.near([-1.47035, 53.3806])).toHaveLength(1);
    expect(index.near([-1.40, 53.30])).toHaveLength(0);
    expect(pointInRing([-1.47035, 53.3806], square)).toBe(true);
  });
});

describe('hexagon density', () => {
  it('bins nearby points together and keeps distant ones apart', () => {
    const origin: LonLat = [-1.4701, 53.3811];
    const bins = hexBin([[-1.4701, 53.3811], [-1.47011, 53.38111], [-1.40, 53.40]], 280, origin);
    expect(bins).toHaveLength(2);
    expect(bins.find((b) => b.count === 2)).toBeDefined();
    expect(bins[0]!.ring).toHaveLength(7);
  });
});

describe('path helpers', () => {
  const path: LonLat[] = [[-1.5, 53.38], [-1.49, 53.38], [-1.49, 53.39]];
  it('computes bounds', () => { expect(boundsOf(path)).toEqual([[-1.5, 53.38], [-1.49, 53.39]]); expect(boundsOf([])).toBeNull(); });
  it('truncates paths proportionally', () => {
    const half = truncatePath(path, 0.5);
    const total = distanceMetres(path[0]!, path[1]!) + distanceMetres(path[1]!, path[2]!);
    const length = half.slice(1).reduce((sum, p, i) => sum + distanceMetres(half[i]!, p), 0);
    expect(length / total).toBeCloseTo(0.5, 2);
  });
  it('morphs one route into another', () => {
    const to: LonLat[] = [[-1.5, 53.38], [-1.48, 53.37]];
    expect(morphPath(path, to, 1)).toBe(to);
    const mid = morphPath(path, to, 0.5);
    expect(mid).toHaveLength(24);
    expect(mid[0]).toEqual([-1.5, 53.38]);
  });
  it('splits dashes along the path', () => {
    const dashes = dashSegments(path, 100, 50);
    expect(dashes.length).toBeGreaterThan(5);
    dashes.slice(0, -1).forEach(([a, b]) => expect(distanceMetres(a, b)).toBeLessThanOrEqual(100.5));
  });
  it('builds metric circles', () => {
    const ring = circleRing([-1.47, 53.38], 10, 16);
    expect(ring).toHaveLength(17);
    expect(distanceMetres([-1.47, 53.38], ring[0]!)).toBeCloseTo(10, 0);
  });
});

describe('2D pan and zoom maths', () => {
  const w = 800, h = 600;
  it('keeps the point under the cursor fixed while zooming', () => {
    const view = viewAt([-1.4701, 53.3811], 14);
    const before = toWorld(200, 150, view, w, h);
    const zoomed = zoomAt(view, 2, 200, 150, w, h);
    const [x, y] = toScreen(before, zoomed, w, h);
    expect(x).toBeCloseTo(200, 6); expect(y).toBeCloseTo(150, 6);
    expect(zoomOf(zoomed)).toBeCloseTo(15, 6);
  });
  it('pans in the drag direction', () => {
    const view = viewAt([-1.4701, 53.3811], 14);
    const point = toWorld(400, 300, view, w, h);
    const [x] = toScreen(point, panBy(view, 50, 0), w, h);
    expect(x).toBeCloseTo(450, 6);
  });
  it('fits bounds and clamps zoom', () => {
    const fitted = fitView([[-1.5, 53.37], [-1.44, 53.40]], w, h);
    expect(zoomOf(fitted)).toBeGreaterThan(11);
    expect(zoomOf(zoomAt(fitted, 1e9, 0, 0, w, h))).toBeCloseTo(19, 6);
  });
});

describe('palette parsing', () => {
  it('parses resolved CSS colours', () => {
    expect(parseColor('#d9343b')).toEqual([217, 52, 59]);
    expect(parseColor(' rgb(1, 2, 3) ')).toEqual([1, 2, 3]);
    expect(parseColor('color(srgb 1 0.5 0)')).toEqual([255, 128, 0]);
    expect(parseColor('')).toBeNull();
    expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
  });
});
