import type { CaseMarker, RouteDatum, StopDatum, WorkerMarker } from '../lib/derive';
import type { Bounds, LonLat } from '../lib/geo';
import type { GeoData } from '../hooks/useGeoData';

export interface LayerVisibility { stock: boolean; cases: boolean; workers: boolean; routes: boolean; basemap: boolean; }
export const DEFAULT_LAYERS: LayerVisibility = { stock: true, cases: true, workers: true, routes: true, basemap: false };

export interface MapScene {
  caseMarkers: CaseMarker[];
  workers: WorkerMarker[];
  activeRoutes: RouteDatum[];
  activeStops: StopDatum[];
  proposedRoutes: RouteDatum[];
  proposedStops: StopDatum[];
  /** Routes from the plan that was active before the latest approval; drawn fading out during the transition. */
  releasedRoutes: RouteDatum[];
}

export interface MapSelection { propertyId: string | null; stockId: string | null; workerId: string | null; }
export type MapPick = { kind: 'property'; id: string } | { kind: 'stock'; id: string } | { kind: 'worker'; id: string };
export interface FocusRequest { key: number; position: LonLat; }
export interface MapInsets { top: number; right: number; bottom: number; left: number; }

export interface MapViewProps {
  geo: GeoData;
  scene: MapScene;
  extent: Bounds | null;
  selection: MapSelection;
  layers: LayerVisibility;
  focus: FocusRequest | null;
  resetKey: number;
  insets: MapInsets;
  reducedMotion: boolean;
  routeProgress: number;
  emergencyPulse: number;
  emergencyPropertyId: string | null;
  onPick(pick: MapPick): void;
  onFailure(reason: string): void;
  onBasemapError(): void;
}

/** Heights are schematic: storeys × nominal storey height × exaggeration so low-rise stock remains visible at city scale. */
export const STOREY_METRES = 3;
export const HEIGHT_EXAGGERATION = 4;
