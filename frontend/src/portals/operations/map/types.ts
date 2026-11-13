import type { CaseMarker, RouteDatum, StopDatum, WorkerMarker } from '../lib/derive';
import type { Bounds, LonLat, Ring } from '../lib/geo';
import type { LocalMapData } from '../hooks/useLocalMapData';

export interface LayerVisibility {
  buildings: boolean;      // basemap 3D buildings
  caseBuildings: boolean;  // case footprints by severity
  hazards: boolean;        // glowing hazard columns
  density: boolean;        // hexagon density (off by default)
  operatives: boolean;
  routes: boolean;
  labels: boolean;         // neighbourhood and street labels
}
export const DEFAULT_LAYERS: LayerVisibility = { buildings: true, caseBuildings: true, hazards: true, density: false, operatives: true, routes: true, labels: true };

/** Where streets and buildings come from. `auto` = OpenFreeMap tiles when reachable, else local files. */
export type DataPreference = 'auto' | 'tiles' | 'local';
export type ActiveSource = 'tiles' | 'local' | 'none';

export interface MapScene {
  caseMarkers: CaseMarker[];
  workers: WorkerMarker[];
  activeRoutes: RouteDatum[];
  activeStops: StopDatum[];
  proposedRoutes: RouteDatum[];
  proposedStops: StopDatum[];
  releasedRoutes: RouteDatum[];
  densityPoints: LonLat[];
}

/** A case located on the twin: its building shell (or an approximate marker) plus its hazard column. */
export interface CaseScene {
  marker: CaseMarker;
  shell: Ring;
  height: number;
  radius: number;
  columnRing: Ring;
  glowRing: Ring;
  location: 'inside' | 'nearest' | 'approximate';
}

export interface PlaceLabel { id: string; name: string; kind: string; position: LonLat; }

export interface MapSelection { propertyId: string | null; workerId: string | null; }
export type MapPick = { kind: 'property'; id: string } | { kind: 'worker'; id: string };
export interface FocusRequest { key: number; position: LonLat; }
export interface MapInsets { top: number; right: number; bottom: number; left: number; }

export interface MapViewProps {
  local: LocalMapData;
  scene: MapScene;
  extent: Bounds | null;
  selection: MapSelection;
  layers: LayerVisibility;
  dataPreference: DataPreference;
  focus: FocusRequest | null;
  resetKey: number;
  fitKey: number;
  insets: MapInsets;
  reducedMotion: boolean;
  theme: 'light' | 'dark';
  routeProgress: number;
  emergencyPulse: number;
  onPick(pick: MapPick): void;
  onFailure(reason: string): void;
  onSourceChange(source: ActiveSource): void;
  onCaseLocations(locations: Record<string, CaseScene['location']>): void;
}

/** Central Sheffield (city centre) — the initial and reset view. */
export const HOME_VIEW = { center: [-1.4701, 53.3811] as LonLat, zoom: 15.1, pitch: 58, bearing: -17 };
