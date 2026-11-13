import { describe, expect, it } from 'vitest';
import type { CaseMarker } from '../lib/derive';
import { footprintsFrom, type Ring } from '../lib/geo';
import { buildCaseScene, placeLabels } from './scene';

const square: Ring = [[-1.4705, 53.3805], [-1.4702, 53.3805], [-1.4702, 53.3807], [-1.4705, 53.3807], [-1.4705, 53.3805]];
const marker = (position: [number, number]): CaseMarker => ({ propertyId: 'p-x', position, floors: 3, severity: 'significant', hazard: 'leak', emergency: false, caseIds: ['HS-1'], primaryCaseId: 'HS-1', label: 'HS-1', area: 'City Centre' });

describe('case scene', () => {
  const footprints = footprintsFrom([{ id: 'b', geometry: { type: 'Polygon', coordinates: [square] }, properties: { render_height: 21 } }]);
  it('puts a case on its building at the building’s real height', () => {
    const [scene] = buildCaseScene([marker([-1.47035, 53.3806])], () => footprints);
    expect(scene!.location).toBe('inside');
    expect(scene!.height).toBeCloseTo(21.6, 5);
    expect(scene!.columnRing.length).toBeGreaterThan(10);
  });
  it('falls back to an approximate metric marker when no building is near', () => {
    const [scene] = buildCaseScene([marker([-1.40, 53.30])], () => footprints);
    expect(scene!.location).toBe('approximate');
    expect(scene!.radius).toBe(10);
  });
});

describe('neighbourhood labels', () => {
  it('drops lower-level labels that would overlap a higher-level one', () => {
    const point = (name: string, place: string, lon: number) => ({ id: name, geometry: { type: 'Point', coordinates: [lon, 53.38] }, properties: { name, place } });
    const labels = placeLabels({ buildings: null, roads: null, places: { metadata: { source: 's', label: 'l', attribution: null }, skipped: 0, features: [point('City Centre', 'neighbourhood', -1.4701), point('Sheffield', 'city', -1.4702), point('Walkley', 'suburb', -1.50)] } });
    expect(labels.map((l) => l.name)).toEqual(['Sheffield', 'Walkley']);
  });
});
