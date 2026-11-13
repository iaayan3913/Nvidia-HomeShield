/**
 * deck.gl layers for the interleaved overlay. All sizes are metric and constant — nothing scales with zoom,
 * so case buildings and hazard columns behave like physical objects. Groups are memoised separately.
 */
import { LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { RouteDatum, StopDatum, WorkerMarker } from '../lib/derive';
import { circleRing, dashSegments, metresPerPixel, morphPath, truncatePath, type HexBin, type LonLat, type Ring } from '../lib/geo';
import { withAlpha, type MapPalette } from '../lib/palette';
import type { CaseScene, PlaceLabel } from './types';

const FONT = '"Source Sans 3", system-ui, sans-serif';
/** Overlays that must stay legible above buildings. */
const ON_TOP = { depthCompare: 'always' as const };
/** Additive glow that never occludes what is behind it. */
const GLOW = { depthWriteEnabled: false, blend: true, blendColorOperation: 'add' as const, blendColorSrcFactor: 'src-alpha' as const, blendColorDstFactor: 'one' as const, blendAlphaOperation: 'add' as const, blendAlphaSrcFactor: 'one' as const, blendAlphaDstFactor: 'one' as const };

export const HAZARD_COLUMN_RADIUS = 9;
export const HAZARD_COLUMN_RISE = 45;
export const LAYER_IDS = { caseBuildings: 'case-buildings', hazard: 'hazard-columns', operatives: 'operatives', activeStops: 'active-stops', proposedStops: 'proposed-stops', density: 'case-density' } as const;

export const columnRing = (position: LonLat): Ring => circleRing(position, HAZARD_COLUMN_RADIUS, 20);
export const glowRing = (position: LonLat): Ring => circleRing(position, HAZARD_COLUMN_RADIUS * 1.6, 20);

export function caseLayers(cases: CaseScene[], palette: MapPalette, show: { buildings: boolean; hazards: boolean }, selectedPropertyId: string | null, pulse: number) {
  const selected = cases.find((c) => c.marker.propertyId === selectedPropertyId) ?? null;
  const wave = pulse < 1 ? (Math.sin(pulse * Math.PI * 6 - Math.PI / 2) + 1) / 2 : 0; // finite pulse, then calm
  const labelled = cases.filter((c) => c.marker.emergency || c.marker.propertyId === selectedPropertyId);
  return [
    new SolidPolygonLayer<CaseScene>({
      id: LAYER_IDS.caseBuildings, data: cases, visible: show.buildings, extruded: true,
      getPolygon: (d) => d.shell, getElevation: (d) => d.height,
      getFillColor: (d) => withAlpha(palette.severity[d.marker.severity], 245),
      pickable: true, autoHighlight: true, highlightColor: withAlpha(palette.selected, 140),
      material: { ambient: 0.55, diffuse: 0.55, shininess: 12 },
    }),
    new SolidPolygonLayer<CaseScene>({
      id: 'hazard-glow', data: cases, visible: show.hazards, extruded: true,
      getPolygon: (d) => d.glowRing, getElevation: (d) => d.height + HAZARD_COLUMN_RISE + 6,
      getFillColor: (d) => withAlpha(palette.hazard[d.marker.hazard], d.marker.emergency ? 45 + 60 * wave : 34),
      updateTriggers: { getFillColor: wave }, parameters: GLOW, material: false,
    }),
    new SolidPolygonLayer<CaseScene>({
      id: LAYER_IDS.hazard, data: cases, visible: show.hazards, extruded: true,
      getPolygon: (d) => d.columnRing, getElevation: (d) => d.height + HAZARD_COLUMN_RISE,
      getFillColor: (d) => withAlpha(palette.hazard[d.marker.hazard], 235),
      pickable: true, autoHighlight: true, highlightColor: withAlpha(palette.selected, 160), material: false,
    }),
    new ScatterplotLayer<CaseScene>({
      id: 'selection-ring', data: selected ? [selected] : [], getPosition: (d) => d.marker.position,
      getRadius: (d) => Math.max(28, d.radius * 1.6), radiusUnits: 'meters', radiusMinPixels: 14, filled: false, stroked: true,
      getLineColor: withAlpha(palette.selected, 255), lineWidthUnits: 'pixels', getLineWidth: 3, parameters: ON_TOP,
    }),
    new TextLayer<CaseScene>({
      id: 'case-labels', data: labelled, fontFamily: FONT, fontWeight: 700,
      getPosition: (d) => [d.marker.position[0], d.marker.position[1], d.height + HAZARD_COLUMN_RISE + 8],
      getText: (d) => (d.marker.emergency ? `! ${d.marker.label}` : d.marker.label), getSize: 13, sizeUnits: 'pixels',
      getPixelOffset: [0, -12], getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
      getColor: (d) => withAlpha(d.marker.propertyId === selectedPropertyId ? palette.selected : palette.label, 255),
      background: true, getBackgroundColor: withAlpha(palette.labelHalo, 235), backgroundPadding: [5, 2, 5, 2],
      getBorderColor: (d) => withAlpha(d.marker.emergency ? palette.severity.emergency : palette.selected, 255), getBorderWidth: 1,
      updateTriggers: { getColor: selectedPropertyId }, parameters: ON_TOP,
    }),
  ];
}

export function densityLayers(bins: HexBin[], palette: MapPalette, visible: boolean) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return [new SolidPolygonLayer<HexBin>({
    id: LAYER_IDS.density, data: bins, visible, extruded: true, getPolygon: (d) => d.ring, getElevation: (d) => 20 + 140 * (d.count / max),
    getFillColor: (d) => withAlpha(palette.density, 60 + 140 * (d.count / max)), pickable: true, material: false,
    parameters: { depthWriteEnabled: false },
  })];
}

export function workerLayers(workers: WorkerMarker[], palette: MapPalette, visible: boolean, selectedId: string | null) {
  return [
    new ScatterplotLayer<WorkerMarker>({
      id: LAYER_IDS.operatives, data: workers, visible, getPosition: (d) => d.position, radiusUnits: 'pixels',
      getRadius: (d) => (d.id === selectedId ? 15 : 12), filled: true, getFillColor: withAlpha(palette.labelHalo, 245), stroked: true,
      getLineColor: (d) => withAlpha(d.id === selectedId ? palette.selected : d.busy ? palette.active : palette.operativeIdle, 255),
      lineWidthUnits: 'pixels', getLineWidth: (d) => (d.id === selectedId ? 3 : 2), pickable: true, autoHighlight: true,
      highlightColor: withAlpha(palette.selected, 90), updateTriggers: { getRadius: selectedId, getLineColor: selectedId, getLineWidth: selectedId }, parameters: ON_TOP,
    }),
    new TextLayer<WorkerMarker>({
      id: 'operative-initials', data: workers, visible, fontFamily: FONT, fontWeight: 700,
      getPosition: (d) => d.position, getText: (d) => d.initials, getSize: 11, sizeUnits: 'pixels',
      getColor: withAlpha(palette.operative, 255), getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP,
    }),
  ];
}

export function placeLabelLayers(places: PlaceLabel[], palette: MapPalette, visible: boolean) {
  return [new TextLayer<PlaceLabel>({
    id: 'neighbourhood-labels', data: places, visible, fontFamily: FONT, fontWeight: 600,
    getPosition: (d) => d.position, getText: (d) => d.name, getSize: (d) => (d.kind === 'city' ? 16 : d.kind === 'suburb' ? 14 : 13), sizeUnits: 'pixels',
    getColor: withAlpha(palette.label, 255), background: true, getBackgroundColor: withAlpha(palette.labelHalo, 190), backgroundPadding: [4, 1, 4, 1], sizeMinPixels: 12,
    getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP,
  })];
}

export interface RouteLayerInput {
  active: RouteDatum[]; activeStops: StopDatum[]; proposed: RouteDatum[]; proposedStops: StopDatum[]; released: RouteDatum[];
  progress: number; zoom: number; latitude: number;
}

/** Approved routes solid; pending proposals dashed with hollow stops. On approval new routes morph out of the old ones. */
export function routeLayers(input: RouteLayerInput, palette: MapPalette, visible: boolean) {
  const { active, activeStops, proposed, proposedStops, released, progress, zoom, latitude } = input;
  const animatedActive = progress < 1 ? active.map((route) => {
    const previous = released.find((r) => r.workerId === route.workerId);
    return { ...route, path: previous ? morphPath(previous.path, route.path, progress) : truncatePath(route.path, progress) };
  }) : active;
  const fading = progress < 1 ? released.filter((r) => !active.some((a) => a.workerId === r.workerId)) : [];
  const mpp = metresPerPixel(Math.round(zoom), latitude);
  type Dash = { id: string; from: LonLat; to: LonLat };
  const dashes: Dash[] = proposed.flatMap((route) => dashSegments(route.path, mpp * 12, mpp * 8).map(([from, to], index) => ({ id: `${route.id}-${index}`, from, to })));
  const stopsVisible = progress >= 1 ? activeStops : [];
  return [
    new PathLayer<RouteDatum>({ id: 'released-routes', data: fading, visible, getPath: (d) => d.path, getColor: withAlpha(palette.operativeIdle, 200 * (1 - progress)), getWidth: 3, widthUnits: 'pixels', updateTriggers: { getColor: progress }, parameters: ON_TOP }),
    new PathLayer<RouteDatum>({ id: 'active-route-casing', data: animatedActive, visible, getPath: (d) => d.path, getColor: withAlpha(palette.labelHalo, 230), getWidth: 8, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: ON_TOP }),
    new PathLayer<RouteDatum>({ id: 'active-routes', data: animatedActive, visible, getPath: (d) => d.path, getColor: withAlpha(palette.active, 255), getWidth: 4, widthUnits: 'pixels', capRounded: true, jointRounded: true, parameters: ON_TOP }),
    new LineLayer<Dash>({ id: 'proposed-route-casing', data: dashes, visible, getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to, getColor: withAlpha(palette.labelHalo, 230), getWidth: 7, widthUnits: 'pixels', parameters: ON_TOP }),
    new LineLayer<Dash>({ id: 'proposed-routes', data: dashes, visible, getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to, getColor: withAlpha(palette.proposed, 255), getWidth: 3.5, widthUnits: 'pixels', parameters: ON_TOP }),
    new ScatterplotLayer<StopDatum>({ id: LAYER_IDS.activeStops, data: stopsVisible, visible, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 9, filled: true, getFillColor: withAlpha(palette.active, 255), stroked: true, getLineColor: withAlpha(palette.labelHalo, 255), lineWidthUnits: 'pixels', getLineWidth: 2, pickable: true, parameters: ON_TOP }),
    new ScatterplotLayer<StopDatum>({ id: LAYER_IDS.proposedStops, data: proposedStops, visible, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 10, filled: true, getFillColor: withAlpha(palette.labelHalo, 255), stroked: true, getLineColor: withAlpha(palette.proposed, 255), lineWidthUnits: 'pixels', getLineWidth: 2.5, pickable: true, parameters: ON_TOP }),
    new TextLayer<StopDatum>({ id: 'stop-sequence', data: [...stopsVisible, ...proposedStops], visible, fontFamily: FONT, fontWeight: 700, getPosition: (d) => d.position, getText: (d) => String(d.sequence), getSize: 11, sizeUnits: 'pixels', getColor: (d) => withAlpha(d.status === 'active' ? palette.labelHalo : palette.proposed, 255), getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP }),
  ];
}
