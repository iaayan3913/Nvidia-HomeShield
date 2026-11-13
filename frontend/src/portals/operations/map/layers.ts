/**
 * deck.gl layer factories. Each group is built separately so the portal can memoise them independently:
 * the 400-point stock layer is only rebuilt when the stock data, visibility or selected unit changes.
 */
import { LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { CaseMarker, RouteDatum, StopDatum, WorkerMarker } from '../lib/derive';
import { dashSegments, metresPerPixel, truncatePath, type LonLat, type RoadFeature, type StockUnit } from '../lib/geo';
import { withAlpha, type MapPalette } from '../lib/palette';
import { HEIGHT_EXAGGERATION, STOREY_METRES } from './types';

const FONT = '"Source Sans 3", system-ui, sans-serif';
/** Always draw overlays (routes, markers, labels) above the schematic columns for legibility. */
const ON_TOP = { depthCompare: 'always' as const };
const heightFor = (floors: number) => floors * STOREY_METRES * HEIGHT_EXAGGERATION;

/** Schematic prism outline around a point (not a building footprint). */
function prism([lon, lat]: LonLat, radiusMetres: number, sides: number): LonLat[] {
  const dLat = radiusMetres / 111_320; const dLon = radiusMetres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: sides }, (_, i) => { const a = (2 * Math.PI * i) / sides + Math.PI / sides; return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] as LonLat; });
}

/** Zoom-aware schematic sizing so markers stay legible from city scale to street scale. */
export function markerScale(zoom: number, latitude: number) {
  const mpp = metresPerPixel(zoom, latitude);
  return { stockRadius: Math.max(26, mpp * 2.6), caseRadius: Math.max(46, mpp * 6), elevationScale: Math.min(9, Math.max(1, mpp / 6)) };
}
export type MarkerScale = ReturnType<typeof markerScale>;

export const LAYER_IDS = { stock: 'stock-units', cases: 'case-properties', workers: 'operatives', activeStops: 'active-stops', proposedStops: 'proposed-stops' } as const;

export function roadLayers(roads: RoadFeature[], palette: MapPalette) {
  return [new PathLayer<RoadFeature>({
    id: 'roads', data: roads, getPath: (d) => d.path, getColor: withAlpha(palette.road, 210),
    getWidth: 1.6, widthUnits: 'pixels', widthMinPixels: 1, capRounded: true, jointRounded: true, pickable: false,
  })];
}

export function stockLayers(stock: StockUnit[], palette: MapPalette, visible: boolean, selectedId: string | null, dimmed: boolean, scale: MarkerScale) {
  return [new SolidPolygonLayer<StockUnit>({
    id: LAYER_IDS.stock, data: stock, visible, extruded: true, elevationScale: scale.elevationScale,
    getPolygon: (d) => prism(d.position, scale.stockRadius, 6), getElevation: (d) => heightFor(d.floors),
    getFillColor: (d) => (d.id === selectedId ? withAlpha(palette.selected, 255) : withAlpha(palette.stock, dimmed ? 130 : 215)),
    pickable: true, autoHighlight: true, highlightColor: withAlpha(palette.ink, 110),
    updateTriggers: { getFillColor: [selectedId, dimmed], getPolygon: scale.stockRadius },
  })];
}

export function caseLayers(markers: CaseMarker[], palette: MapPalette, visible: boolean, selectedPropertyId: string | null, emergencyPropertyId: string | null, pulse: number, scale: MarkerScale) {
  const selected = markers.find((m) => m.propertyId === selectedPropertyId) ?? null;
  const emergencies = markers.filter((m) => m.emergency);
  // A short, finite pulse when an emergency first appears, then a calm static halo — never constant flashing.
  const wave = pulse < 1 ? (Math.sin(pulse * Math.PI * 6 - Math.PI / 2) + 1) / 2 : 0;
  const labelled = markers.filter((m) => m.emergency || m.propertyId === selectedPropertyId);
  return [
    new ScatterplotLayer<CaseMarker>({
      id: 'emergency-halo', data: emergencies, visible, getPosition: (d) => d.position,
      getRadius: (d) => (d.propertyId === emergencyPropertyId ? scale.caseRadius * (2.4 + 2 * wave) : scale.caseRadius * 2.4), radiusUnits: 'meters', radiusMinPixels: 14,
      filled: true, getFillColor: withAlpha(palette.severity.emergency, 40 + 50 * (1 - wave)), stroked: true,
      getLineColor: withAlpha(palette.severity.emergency, 230 - 120 * wave), lineWidthUnits: 'pixels', getLineWidth: 2,
      updateTriggers: { getRadius: [wave, emergencyPropertyId, scale.caseRadius], getFillColor: wave, getLineColor: wave }, parameters: ON_TOP,
    }),
    new SolidPolygonLayer<CaseMarker>({
      id: LAYER_IDS.cases, data: markers, visible, extruded: true, elevationScale: scale.elevationScale,
      getPolygon: (d) => prism(d.position, scale.caseRadius, 12), getElevation: (d) => heightFor(d.floors) + 40,
      getFillColor: (d) => withAlpha(palette.severity[d.severity], 255),
      pickable: true, autoHighlight: true, highlightColor: withAlpha(palette.ink, 120),
      updateTriggers: { getPolygon: scale.caseRadius },
    }),
    new ScatterplotLayer<CaseMarker>({
      id: 'selection-ring', data: selected ? [selected] : [], visible, getPosition: (d) => d.position,
      getRadius: scale.caseRadius * 1.9, radiusUnits: 'meters', radiusMinPixels: 12, filled: false, stroked: true,
      getLineColor: withAlpha(palette.selected, 255), lineWidthUnits: 'pixels', getLineWidth: 3, parameters: ON_TOP,
    }),
    new TextLayer<CaseMarker>({
      id: 'case-labels', data: labelled, visible, fontFamily: FONT, fontWeight: 700,
      getPosition: (d) => [d.position[0], d.position[1], (heightFor(d.floors) + 40) * scale.elevationScale], getText: (d) => (d.emergency ? `! ${d.label}` : d.label),
      getSize: 13, sizeUnits: 'pixels', getPixelOffset: [0, -16], getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
      getColor: (d) => withAlpha(d.propertyId === selectedPropertyId ? palette.selected : palette.ink, 255),
      background: true, getBackgroundColor: withAlpha(palette.canvas, 235), backgroundPadding: [5, 2, 5, 2],
      getBorderColor: (d) => withAlpha(d.emergency ? palette.severity.emergency : palette.selected, 255), getBorderWidth: 1,
      updateTriggers: { getColor: selectedPropertyId, getPosition: scale.elevationScale }, parameters: ON_TOP,
    }),
  ];
}

export function workerLayers(workers: WorkerMarker[], palette: MapPalette, visible: boolean, selectedId: string | null) {
  return [
    new ScatterplotLayer<WorkerMarker>({
      id: LAYER_IDS.workers, data: workers, visible, getPosition: (d) => d.position, radiusUnits: 'pixels',
      getRadius: (d) => (d.id === selectedId ? 15 : 12), filled: true, getFillColor: withAlpha(palette.canvas, 245), stroked: true,
      getLineColor: (d) => withAlpha(d.id === selectedId ? palette.selected : d.busy ? palette.active : palette.workerIdle, 255),
      lineWidthUnits: 'pixels', getLineWidth: (d) => (d.id === selectedId ? 3 : 2), pickable: true, autoHighlight: true,
      highlightColor: withAlpha(palette.ink, 70), updateTriggers: { getRadius: selectedId, getLineColor: selectedId, getLineWidth: selectedId }, parameters: ON_TOP,
    }),
    new TextLayer<WorkerMarker>({
      id: 'operative-initials', data: workers, visible, fontFamily: FONT, fontWeight: 700,
      getPosition: (d) => d.position, getText: (d) => d.initials, getSize: 11, sizeUnits: 'pixels',
      getColor: withAlpha(palette.worker, 255), getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP,
    }),
  ];
}

export interface RouteLayerInput {
  active: RouteDatum[]; activeStops: StopDatum[]; proposed: RouteDatum[]; proposedStops: StopDatum[]; released: RouteDatum[];
  progress: number; zoom: number; latitude: number;
}

export function routeLayers(input: RouteLayerInput, palette: MapPalette, visible: boolean) {
  const { active, activeStops, proposed, proposedStops, released, progress, zoom, latitude } = input;
  const animatedActive = progress < 1 ? active.map((route) => ({ ...route, path: truncatePath(route.path, progress) })) : active;
  const mpp = metresPerPixel(Math.round(zoom), latitude);
  const dashes = proposed.flatMap((route) => dashSegments(route.path, mpp * 12, mpp * 8).map(([from, to], index) => ({ id: `${route.id}-${index}`, from, to })));
  type Dash = { id: string; from: LonLat; to: LonLat };
  const stopsVisible = progress >= 1 ? activeStops : [];
  return [
    new PathLayer<RouteDatum>({
      id: 'released-routes', data: progress < 1 ? released : [], visible, getPath: (d) => d.path,
      getColor: withAlpha(palette.workerIdle, 200 * (1 - progress)), getWidth: 3, widthUnits: 'pixels',
      updateTriggers: { getColor: progress }, parameters: ON_TOP,
    }),
    new PathLayer<RouteDatum>({
      id: 'active-route-casing', data: animatedActive, visible, getPath: (d) => d.path, getColor: withAlpha(palette.canvas, 230),
      getWidth: 8, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: ON_TOP,
    }),
    new PathLayer<RouteDatum>({
      id: 'active-routes', data: animatedActive, visible, getPath: (d) => d.path, getColor: withAlpha(palette.active, 255),
      getWidth: 4, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: ON_TOP,
    }),
    new LineLayer<Dash>({
      id: 'proposed-route-casing', data: dashes, visible, getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to,
      getColor: withAlpha(palette.canvas, 230), getWidth: 7, widthUnits: 'pixels', parameters: ON_TOP,
    }),
    new LineLayer<Dash>({
      id: 'proposed-routes', data: dashes, visible, getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to,
      getColor: withAlpha(palette.proposed, 255), getWidth: 3.5, widthUnits: 'pixels', parameters: ON_TOP,
    }),
    new ScatterplotLayer<StopDatum>({
      id: LAYER_IDS.activeStops, data: stopsVisible, visible, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 9,
      filled: true, getFillColor: withAlpha(palette.active, 255), stroked: true, getLineColor: withAlpha(palette.canvas, 255),
      lineWidthUnits: 'pixels', getLineWidth: 2, pickable: true, parameters: ON_TOP,
    }),
    new ScatterplotLayer<StopDatum>({
      id: LAYER_IDS.proposedStops, data: proposedStops, visible, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 10,
      filled: true, getFillColor: withAlpha(palette.canvas, 255), stroked: true, getLineColor: withAlpha(palette.proposed, 255),
      lineWidthUnits: 'pixels', getLineWidth: 2.5, pickable: true, parameters: ON_TOP,
    }),
    new TextLayer<StopDatum>({
      id: 'stop-sequence', data: [...stopsVisible, ...proposedStops], visible, fontFamily: FONT, fontWeight: 700,
      getPosition: (d) => d.position, getText: (d) => String(d.sequence), getSize: 11, sizeUnits: 'pixels',
      getColor: (d) => withAlpha(d.status === 'active' ? palette.canvas : palette.proposed, 255),
      getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP,
    }),
  ];
}
