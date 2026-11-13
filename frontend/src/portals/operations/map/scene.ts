import type { CaseMarker } from '../lib/derive';
import { circleRing, distanceMetres, inflateRing, matchFootprint, type Footprint, type FootprintMatch } from '../lib/geo';
import type { LocalMapData } from '../hooks/useLocalMapData';
import { columnRing, glowRing } from './layers';
import type { CaseScene, PlaceLabel } from './types';

const APPROXIMATE_RADIUS = 10;
const APPROXIMATE_HEIGHT = 9;

/** Locate each case on a building footprint (inside, or nearest within 40 m); otherwise an approximate marker. */
export function buildCaseScene(markers: CaseMarker[], candidatesFor: (marker: CaseMarker) => Iterable<Footprint>): CaseScene[] {
  return markers.map((marker) => {
    const match: FootprintMatch | null = matchFootprint(marker.position, candidatesFor(marker));
    if (match) {
      const radius = Math.max(...match.ring.map((p) => distanceMetres(marker.position, p)));
      return {
        marker, location: match.quality,
        // A slightly larger shell drawn just above the basemap building avoids z-fighting with it.
        shell: inflateRing(match.ring, 1.06), height: match.height + 0.6, radius: Math.min(radius, 60),
        columnRing: columnRing(marker.position), glowRing: glowRing(marker.position),
      };
    }
    return {
      marker, location: 'approximate', shell: circleRing(marker.position, APPROXIMATE_RADIUS, 16), height: APPROXIMATE_HEIGHT, radius: APPROXIMATE_RADIUS,
      columnRing: columnRing(marker.position), glowRing: glowRing(marker.position),
    };
  });
}

const PLACE_PRIORITY: Record<string, number> = { city: 0, town: 1, suburb: 2, quarter: 3, neighbourhood: 4, village: 5, hamlet: 6 };
const LABEL_SPACING_METRES = 450;

/** Neighbourhood labels for local mode, de-cluttered so higher-level places win when names would overlap. */
export function placeLabels(local: LocalMapData): PlaceLabel[] {
  const all = (local.places?.features ?? []).flatMap((feature) => {
    const coords = feature.geometry.coordinates as [number, number];
    const name = typeof feature.properties.name === 'string' ? feature.properties.name : null;
    return name && Array.isArray(coords) ? [{ id: feature.id, name, kind: String(feature.properties.place ?? 'locality'), position: [coords[0], coords[1]] as [number, number] }] : [];
  }).sort((a, b) => (PLACE_PRIORITY[a.kind] ?? 9) - (PLACE_PRIORITY[b.kind] ?? 9));
  const kept: PlaceLabel[] = [];
  for (const label of all) if (!kept.some((k) => distanceMetres(k.position, label.position) < LABEL_SPACING_METRES)) kept.push(label);
  return kept;
}
