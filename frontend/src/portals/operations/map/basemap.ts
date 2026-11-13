/**
 * Basemap built in code. Two interchangeable layer groups share one styling table:
 *  - "tiles": OpenFreeMap vector tiles (OpenMapTiles schema), added only when online tiles are attempted;
 *  - "local": GeoJSON from scripts/fetch-sheffield.py (covers offline use).
 * Theme changes call setPaintProperty on existing layers only — never setStyle — so tiles are not refetched.
 */
import type { Map as MapLibreMap, StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { LocalMapData } from '../hooks/useLocalMapData';
import { css, type MapPalette } from '../lib/palette';

export const OFM_SOURCE = 'openfreemap';
export const OFM_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const OFM_FONT = ['Noto Sans Regular'];
export const OFM_ATTRIBUTION_TEXT = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
export const OSM_ATTRIBUTION_TEXT = '© OpenStreetMap contributors (ODbL)';

export type BasemapMode = 'tiles' | 'local' | 'none';
export type GroupId = 'buildings' | 'labels';

type Paint = Record<string, (p: MapPalette) => unknown>;
interface LayerDef { id: string; group?: GroupId; spec: (p: MapPalette) => LayerSpecification; paint: Paint; }

const MAJOR = ['motorway', 'trunk', 'primary'];
const MID = ['secondary', 'tertiary'];
const MINOR = ['minor', 'service', 'unclassified', 'residential', 'living_street', 'pedestrian'];
const width = (base: number): ExpressionSpecification => ['interpolate', ['exponential', 1.6], ['zoom'], 11, base * 0.35, 14, base, 18, base * 6];

const roadPaint = (key: 'roadMajor' | 'road' | 'roadMinor', w: number): Paint => ({ 'line-color': (p) => css(p[key]), 'line-width': () => width(w) });
const buildingPaint = (height: ExpressionSpecification, base: ExpressionSpecification): Paint => ({
  'fill-extrusion-color': (p) => css(p.building),
  // Real metric heights from the data. No zoom-dependent scaling: buildings grow as you zoom in.
  'fill-extrusion-height': () => height,
  'fill-extrusion-base': () => base,
  'fill-extrusion-opacity': (p) => (p.theme === 'dark' ? 0.92 : 0.88),
  'fill-extrusion-vertical-gradient': () => true,
});
const labelPaint: Paint = { 'text-color': (p) => css(p.label), 'text-halo-color': (p) => css(p.labelHalo), 'text-halo-width': () => 1.4 };

function build(defs: LayerDef[], palette: MapPalette): LayerSpecification[] {
  return defs.map((def) => {
    const spec = def.spec(palette) as LayerSpecification & { paint?: Record<string, unknown> };
    spec.paint = Object.fromEntries(Object.entries(def.paint).map(([key, value]) => [key, value(palette)]));
    return spec;
  });
}

const TILE_LAYERS: LayerDef[] = [
  { id: 'ofm-landcover', spec: () => ({ id: 'ofm-landcover', type: 'fill', source: OFM_SOURCE, 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]] }), paint: { 'fill-color': (p) => css(p.park), 'fill-opacity': () => 0.55 } },
  { id: 'ofm-park', spec: () => ({ id: 'ofm-park', type: 'fill', source: OFM_SOURCE, 'source-layer': 'park' }), paint: { 'fill-color': (p) => css(p.park), 'fill-opacity': () => 0.8 } },
  { id: 'ofm-water', spec: () => ({ id: 'ofm-water', type: 'fill', source: OFM_SOURCE, 'source-layer': 'water' }), paint: { 'fill-color': (p) => css(p.water) } },
  { id: 'ofm-waterway', spec: () => ({ id: 'ofm-waterway', type: 'line', source: OFM_SOURCE, 'source-layer': 'waterway' }), paint: { 'line-color': (p) => css(p.water), 'line-width': () => width(1.2) } },
  { id: 'ofm-rail', spec: () => ({ id: 'ofm-rail', type: 'line', source: OFM_SOURCE, 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'] }), paint: { 'line-color': (p) => css(p.rail), 'line-width': () => width(0.8), 'line-dasharray': () => ['literal', [3, 2]] } },
  { id: 'ofm-road-minor', spec: () => ({ id: 'ofm-road-minor', type: 'line', source: OFM_SOURCE, 'source-layer': 'transportation', minzoom: 12.5, filter: ['in', ['get', 'class'], ['literal', MINOR]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('roadMinor', 1.2) },
  { id: 'ofm-road', spec: () => ({ id: 'ofm-road', type: 'line', source: OFM_SOURCE, 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', MID]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('road', 2) },
  { id: 'ofm-road-major', spec: () => ({ id: 'ofm-road-major', type: 'line', source: OFM_SOURCE, 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', MAJOR]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('roadMajor', 2.8) },
  { id: 'ofm-buildings', group: 'buildings', spec: () => ({ id: 'ofm-buildings', type: 'fill-extrusion', source: OFM_SOURCE, 'source-layer': 'building', minzoom: 13, filter: ['!', ['has', 'hide_3d']] }),
    paint: buildingPaint(['coalesce', ['get', 'render_height'], 6], ['coalesce', ['get', 'render_min_height'], 0]) },
  { id: 'ofm-street-labels', group: 'labels', spec: () => ({ id: 'ofm-street-labels', type: 'symbol', source: OFM_SOURCE, 'source-layer': 'transportation_name', minzoom: 15,
    layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': OFM_FONT, 'text-size': 11 } }), paint: labelPaint },
  { id: 'ofm-place-labels', group: 'labels', spec: () => ({ id: 'ofm-place-labels', type: 'symbol', source: OFM_SOURCE, 'source-layer': 'place',
    filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village']]],
    layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': OFM_FONT, 'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 14, 'suburb', 13, 12], 'text-padding': 6, 'text-max-width': 8 } }), paint: labelPaint },
];

const LOCAL_LAYERS: LayerDef[] = [
  { id: 'local-road-minor', spec: () => ({ id: 'local-road-minor', type: 'line', source: 'local-roads', minzoom: 12.5, filter: ['!', ['in', ['get', 'highway'], ['literal', [...MAJOR, ...MID, 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']]]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('roadMinor', 1.2) },
  { id: 'local-road', spec: () => ({ id: 'local-road', type: 'line', source: 'local-roads', filter: ['in', ['get', 'highway'], ['literal', [...MID, 'secondary_link', 'tertiary_link']]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('road', 2) },
  { id: 'local-road-major', spec: () => ({ id: 'local-road-major', type: 'line', source: 'local-roads', filter: ['in', ['get', 'highway'], ['literal', [...MAJOR, 'motorway_link', 'trunk_link', 'primary_link']]], layout: { 'line-cap': 'round', 'line-join': 'round' } }), paint: roadPaint('roadMajor', 2.8) },
  { id: 'local-buildings', group: 'buildings', spec: () => ({ id: 'local-buildings', type: 'fill-extrusion', source: 'local-buildings', minzoom: 12 }),
    paint: buildingPaint(['coalesce', ['get', 'height'], 6], ['coalesce', ['get', 'min_height'], 0]) },
];

export function baseStyle(palette: MapPalette): StyleSpecification {
  return { version: 8, glyphs: OFM_GLYPHS, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': css(palette.land) } }] };
}

export function addTileLayers(map: MapLibreMap, palette: MapPalette) {
  if (map.getSource(OFM_SOURCE)) return;
  map.addSource(OFM_SOURCE, { type: 'vector', url: OFM_TILEJSON, attribution: OFM_ATTRIBUTION_TEXT });
  build(TILE_LAYERS, palette).forEach((layer) => map.addLayer(layer));
}

export function addLocalLayers(map: MapLibreMap, palette: MapPalette, data: LocalMapData) {
  if (map.getSource('local-roads') || map.getSource('local-buildings')) return;
  const toGeoJSON = (collection: LocalMapData['buildings']) => ({ type: 'FeatureCollection' as const, features: (collection?.features ?? []).map((f) => ({ type: 'Feature' as const, id: f.id, geometry: f.geometry as GeoJSON.Geometry, properties: f.properties })) });
  if (data.roads) map.addSource('local-roads', { type: 'geojson', data: toGeoJSON(data.roads), attribution: OSM_ATTRIBUTION_TEXT });
  if (data.buildings) map.addSource('local-buildings', { type: 'geojson', data: toGeoJSON(data.buildings), attribution: OSM_ATTRIBUTION_TEXT });
  // Insert below any tile layers so either group can be shown without reordering.
  const before = map.getLayer('ofm-landcover') ? 'ofm-landcover' : undefined;
  build(LOCAL_LAYERS.filter((def) => map.getSource((def.spec(palette) as { source: string }).source)), palette).forEach((layer) => map.addLayer(layer, before));
}

/** Show exactly one data group and apply the user's group toggles. */
export function applyVisibility(map: MapLibreMap, mode: BasemapMode, groups: Record<GroupId, boolean>) {
  for (const def of [...TILE_LAYERS, ...LOCAL_LAYERS]) {
    if (!map.getLayer(def.id)) continue;
    const inMode = def.id.startsWith('ofm-') ? mode === 'tiles' : mode === 'local';
    const visible = inMode && (!def.group || groups[def.group]);
    map.setLayoutProperty(def.id, 'visibility', visible ? 'visible' : 'none');
  }
}

/** Recolour in place for a theme change. */
export function applyPalette(map: MapLibreMap, palette: MapPalette) {
  if (map.getLayer('background')) map.setPaintProperty('background', 'background-color', css(palette.land));
  for (const def of [...TILE_LAYERS, ...LOCAL_LAYERS]) {
    if (!map.getLayer(def.id)) continue;
    for (const [property, value] of Object.entries(def.paint)) {
      if (property.includes('color') || property.endsWith('opacity')) (map.setPaintProperty as (layer: string, name: string, value: unknown) => void).call(map, def.id, property, value(palette));
    }
  }
}

export const BASEMAP_LAYER_IDS = [...TILE_LAYERS, ...LOCAL_LAYERS].map((def) => def.id);
