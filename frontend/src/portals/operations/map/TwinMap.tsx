/**
 * Sheffield digital twin: MapLibre GL with OpenFreeMap vector tiles (or local OSM GeoJSON offline) and one
 * interleaved deck.gl overlay. Loaded lazily so the 2D fallback never pays for (or crashes on) WebGL code.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import { ChevronsDown, ChevronsUp, Compass, Focus, Minus, Plus, RotateCcw, RotateCw, ScanEye } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { readPalette } from '../lib/palette';
import { FootprintIndex, footprintsFrom, hexBin, outerRings, buildingHeight, type Footprint } from '../lib/geo';
import { HAZARD_LABEL, SEVERITY_LABEL } from '../lib/format';
import type { StopDatum, WorkerMarker } from '../lib/derive';
import { OFM_SOURCE, addLocalLayers, addTileLayers, applyPalette, applyVisibility, baseStyle } from './basemap';
import { LAYER_IDS, caseLayers, densityLayers, placeLabelLayers, routeLayers, workerLayers } from './layers';
import { buildCaseScene, placeLabels } from './scene';
import { HOME_VIEW, type ActiveSource, type CaseScene, type MapInsets, type MapViewProps } from './types';

setWorkerUrl(workerUrl);

const MAX_PITCH = 75;
const LOCATION_TEXT: Record<CaseScene['location'], string> = { inside: 'Reported building', nearest: 'Nearest building to the reported point (within 40 m)', approximate: 'Approximate location (no building footprint found)' };

function tooltipText(info: PickingInfo): string | null {
  const object = info.object as unknown;
  if (!object || !info.layer) return null;
  switch (info.layer.id) {
    case LAYER_IDS.caseBuildings: case LAYER_IDS.hazard: {
      const d = object as CaseScene;
      return `${d.marker.label} · ${SEVERITY_LABEL[d.marker.severity]} · ${HAZARD_LABEL[d.marker.hazard]}\n${d.marker.area}\n${LOCATION_TEXT[d.location]}`;
    }
    case LAYER_IDS.operatives: { const d = object as WorkerMarker; return `${d.name}\n${d.role}${d.busy ? ' · on an approved route' : ' · no approved visits'}`; }
    case LAYER_IDS.activeStops: case LAYER_IDS.proposedStops: { const d = object as StopDatum; return `${d.status === 'active' ? 'Approved' : 'Proposed (awaiting approval)'} stop ${d.sequence}${d.caseId ? ` · ${d.caseId}` : ''}`; }
    case LAYER_IDS.density: { const d = object as { count: number }; return `${d.count} ${d.count === 1 ? 'case' : 'cases'} in this area`; }
    default: return null;
  }
}

const offsetFor = ({ left, right, top, bottom }: MapInsets): [number, number] => [(left - right) / 2, (top - bottom) / 2];

export default function TwinMap(props: MapViewProps) {
  const { local, scene, extent, selection, layers, dataPreference, focus, resetKey, fitKey, insets, reducedMotion, theme, routeProgress, emergencyPulse } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const propsRef = useRef(props); propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(HOME_VIEW.zoom);
  const [camera, setCamera] = useState({ bearing: HOME_VIEW.bearing, pitch: HOME_VIEW.pitch });
  const [source, setSource] = useState<ActiveSource>('none');
  const [tileFootprints, setTileFootprints] = useState<Footprint[]>([]);
  // Palette is re-read from CSS whenever the theme changes; the map is recoloured in place.
  const palette = useMemo(() => readPalette(containerRef.current ?? document.querySelector('.ops')), [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const paletteRef = useRef(palette); paletteRef.current = palette;
  const duration = useCallback((ms: number) => (reducedMotion ? 0 : ms), [reducedMotion]);
  const hasLocal = Boolean(local.buildings || local.roads);

  /* ------------------------------------------------------------ lifecycle */
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container, style: baseStyle(paletteRef.current), center: HOME_VIEW.center, zoom: HOME_VIEW.zoom, pitch: HOME_VIEW.pitch, bearing: HOME_VIEW.bearing,
        maxPitch: MAX_PITCH, minZoom: 10, maxZoom: 19.5, attributionControl: false, fadeDuration: 0,
        canvasContextAttributes: { antialias: true }, reduceMotion: propsRef.current.reducedMotion || undefined,
      });
    } catch {
      propsRef.current.onFailure('The 3D map could not create a WebGL context in this browser.');
      return;
    }
    mapRef.current = map;
    // Compatibility shim: deck.gl 9.4's interleaved renderer reads `map.transform.height` to normalise the
    // near/far planes MapLibre passes to custom layers. MapLibre 6 no longer exposes `transform` at runtime,
    // so provide the one field deck needs (the canvas height in CSS pixels) on this map instance only.
    if (!(map as unknown as { transform?: unknown }).transform) {
      Object.defineProperty(map, 'transform', { configurable: true, get: () => ({ height: map.getCanvas().clientHeight || container.clientHeight }) });
    }
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-label', 'Sheffield digital twin. Arrow keys pan, plus and minus zoom, Shift with arrow keys rotates and tilts.');
    canvas.setAttribute('aria-describedby', 'ops-map-help');

    map.on('error', (event) => {
      const sourceId = (event as { sourceId?: string }).sourceId;
      if (sourceId === OFM_SOURCE || /openfreemap/.test(event.error?.message ?? '')) { tileHealth.current.failures += 1; return; }
      if (/webgl/i.test(event.error?.message ?? '')) propsRef.current.onFailure('The WebGL renderer reported an error.');
    });
    map.on('sourcedata', (event) => { if (event.sourceId === OFM_SOURCE && event.tile) tileHealth.current.loaded += 1; });
    map.on('webglcontextlost', () => propsRef.current.onFailure('The browser discarded the WebGL context (for example after a GPU reset).'));
    map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('moveend', () => setCamera({ bearing: map.getBearing(), pitch: map.getPitch() }));

    const overlay = new MapboxOverlay({
      interleaved: true, layers: [], pickingRadius: 6,
      onClick: (info: PickingInfo) => {
        const object = info.object as { marker?: { propertyId: string }; id?: string; caseId?: string } | undefined;
        if (!object || !info.layer) return;
        const { onPick, scene: current } = propsRef.current;
        if ((info.layer.id === LAYER_IDS.caseBuildings || info.layer.id === LAYER_IDS.hazard) && object.marker) onPick({ kind: 'property', id: object.marker.propertyId });
        else if (info.layer.id === LAYER_IDS.operatives && object.id) onPick({ kind: 'worker', id: object.id });
        else if ((info.layer.id === LAYER_IDS.activeStops || info.layer.id === LAYER_IDS.proposedStops) && object.caseId) {
          const marker = current.caseMarkers.find((m) => m.caseIds.includes(object.caseId!));
          if (marker) onPick({ kind: 'property', id: marker.propertyId });
        }
      },
      onHover: (info: PickingInfo) => { map.getCanvas().style.cursor = info.object ? 'pointer' : ''; },
      getTooltip: (info: PickingInfo) => {
        const text = tooltipText(info);
        return text ? { text, className: 'ops-map-tooltip', style: { background: 'var(--surface)', color: 'var(--ink-900)', border: '1px solid var(--border-strong)', borderRadius: '8px', padding: '6px 9px', font: '600 13px/1.35 "Source Sans 3", system-ui, sans-serif', whiteSpace: 'pre-line', maxWidth: '280px', boxShadow: '0 6px 18px rgb(0 0 0 / .18)' } } : null;
      },
    });
    map.addControl(overlay);
    overlayRef.current = overlay;
    // Development-only handle for automated browser checks; never present in production builds.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as Record<string, unknown>).__homeshieldTwin = map;
    map.on('load', () => setReady(true));
    // Re-match case footprints against freshly loaded tile buildings once rendering settles.
    let idleTimer = 0;
    map.on('idle', () => { window.clearTimeout(idleTimer); idleTimer = window.setTimeout(() => refreshTileFootprints.current(), 150); });

    return () => {
      window.clearTimeout(idleTimer);
      overlayRef.current = null; mapRef.current = null;
      try { overlay.finalize(); } catch { /* already detached */ }
      map.remove();
    };
  }, []);

  /* ------------------------------------------------------------ data source: tiles when reachable, else local */
  const tileHealth = useRef({ loaded: 0, failures: 0 });
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    if (hasLocal) addLocalLayers(map, paletteRef.current, local);
    const useLocal = () => { setSource(hasLocal ? 'local' : 'none'); };
    if (dataPreference === 'local') { useLocal(); return; }
    if (dataPreference === 'auto' && !navigator.onLine) { useLocal(); return; }
    addTileLayers(map, paletteRef.current);
    setSource('tiles');
    tileHealth.current = { loaded: 0, failures: 0 };
    if (dataPreference === 'tiles') return;
    // Auto: fall back to local files if no tile has loaded and requests are failing.
    const timer = window.setInterval(() => {
      const { loaded, failures } = tileHealth.current;
      if (loaded > 0) { window.clearInterval(timer); return; }
      if (failures > 0 || !navigator.onLine) { window.clearInterval(timer); useLocal(); }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [ready, dataPreference, hasLocal, local]);

  useEffect(() => { propsRef.current.onSourceChange(source); }, [source]);
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    applyVisibility(map, source, { buildings: layers.buildings, labels: layers.labels });
  }, [ready, source, layers.buildings, layers.labels]);
  useEffect(() => { const map = mapRef.current; if (ready && map) applyPalette(map, palette); }, [ready, palette]);

  /* ------------------------------------------------------------ case footprints */
  const localIndex = useMemo(() => (local.buildings ? new FootprintIndex(footprintsFrom(local.buildings.features)) : null), [local.buildings]);
  const refreshTileFootprints = useRef(() => undefined as void);
  refreshTileFootprints.current = () => {
    const map = mapRef.current;
    if (!map || source !== 'tiles' || !map.getSource(OFM_SOURCE)) return;
    const markers = propsRef.current.scene.caseMarkers;
    if (!markers.length) return;
    const near = (lon: number, lat: number) => markers.some((m) => Math.abs(m.position[0] - lon) < 0.0025 && Math.abs(m.position[1] - lat) < 0.0015);
    const found: Footprint[] = [];
    let features: Array<{ geometry: unknown; properties: Record<string, unknown> | null }> = [];
    try { features = map.querySourceFeatures(OFM_SOURCE, { sourceLayer: 'building' }); } catch { return; }
    for (const feature of features) {
      for (const ring of outerRings(feature.geometry as { type: string; coordinates: unknown })) {
        if (near(ring[0]![0], ring[0]![1])) found.push({ ring, ...buildingHeight(feature.properties ?? {}) });
      }
    }
    setTileFootprints((previous) => (previous.length === found.length ? previous : found));
  };
  useEffect(() => { refreshTileFootprints.current(); }, [source, scene.caseMarkers]);

  const caseScene = useMemo(() => buildCaseScene(scene.caseMarkers, (marker) => {
    const fromLocal = localIndex?.near(marker.position) ?? [];
    return source === 'tiles' && tileFootprints.length ? [...tileFootprints, ...fromLocal] : fromLocal;
  }), [scene.caseMarkers, localIndex, tileFootprints, source]);
  useEffect(() => { propsRef.current.onCaseLocations(Object.fromEntries(caseScene.map((c) => [c.marker.propertyId, c.location]))); }, [caseScene]);

  /* ------------------------------------------------------------ deck layers (memoised per group) */
  const places = useMemo(() => placeLabels(local), [local]);
  const bins = useMemo(() => hexBin(scene.densityPoints, 280, HOME_VIEW.center), [scene.densityPoints]);
  const cases = useMemo(() => caseLayers(caseScene, palette, { buildings: layers.caseBuildings, hazards: layers.hazards }, selection.propertyId, emergencyPulse), [caseScene, palette, layers.caseBuildings, layers.hazards, selection.propertyId, emergencyPulse]);
  const density = useMemo(() => densityLayers(bins, palette, layers.density), [bins, palette, layers.density]);
  const workers = useMemo(() => workerLayers(scene.workers, palette, layers.operatives, selection.workerId), [scene.workers, palette, layers.operatives, selection.workerId]);
  const labels = useMemo(() => placeLabelLayers(places, palette, layers.labels && source !== 'tiles'), [places, palette, layers.labels, source]);
  const latitude = extent ? (extent[0][1] + extent[1][1]) / 2 : HOME_VIEW.center[1];
  const zoomBucket = Math.round(zoom);
  const routes = useMemo(() => routeLayers({ active: scene.activeRoutes, activeStops: scene.activeStops, proposed: scene.proposedRoutes, proposedStops: scene.proposedStops, released: scene.releasedRoutes, progress: routeProgress, zoom: zoomBucket, latitude }, palette, layers.routes),
    [scene.activeRoutes, scene.activeStops, scene.proposedRoutes, scene.proposedStops, scene.releasedRoutes, routeProgress, zoomBucket, latitude, palette, layers.routes]);
  useEffect(() => { overlayRef.current?.setProps({ layers: [...density, ...cases, ...routes, ...workers, ...labels] }); }, [density, cases, routes, workers, labels]);

  /* ------------------------------------------------------------ camera */
  const goHome = useCallback((animate: boolean) => {
    const map = mapRef.current; if (!map) return;
    const view = { center: HOME_VIEW.center, zoom: HOME_VIEW.zoom, pitch: HOME_VIEW.pitch, bearing: HOME_VIEW.bearing, offset: offsetFor(propsRef.current.insets) };
    if (animate && !propsRef.current.reducedMotion) map.easeTo({ ...view, duration: 800, essential: true }); else map.easeTo({ ...view, duration: 0 });
  }, []);
  const fitCases = useCallback(() => {
    const map = mapRef.current; if (!map || !extent) return;
    const { left, right, top, bottom } = propsRef.current.insets;
    const target = map.cameraForBounds(extent, { padding: { left: left + 60, right: right + 60, top: top + 80, bottom: bottom + 60 }, bearing: map.getBearing() });
    if (target) map.easeTo({ center: target.center, zoom: Math.min(target.zoom ?? 13, 16), pitch: 45, bearing: map.getBearing(), duration: duration(800), essential: true });
  }, [extent, duration]);

  const lastReset = useRef(resetKey);
  useEffect(() => { if (ready && resetKey !== lastReset.current) { lastReset.current = resetKey; goHome(true); } }, [ready, resetKey, goHome]);
  const lastFit = useRef(fitKey);
  useEffect(() => { if (ready && fitKey !== lastFit.current) { lastFit.current = fitKey; fitCases(); } }, [ready, fitKey, fitCases]);

  const lastFocus = useRef<{ key: number; at: number; insets: string } | null>(null);
  const insetKey = `${insets.left}:${insets.right}:${insets.top}:${insets.bottom}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const fresh = focus.key !== lastFocus.current?.key;
    // Panels opening with a selection are measured a frame later; re-centre once if they change the visible area.
    const settling = !fresh && lastFocus.current && lastFocus.current.insets !== insetKey && performance.now() - lastFocus.current.at < 1200;
    if (!fresh && !settling) return;
    lastFocus.current = { key: focus.key, at: fresh ? performance.now() : lastFocus.current!.at, insets: insetKey };
    // Short, direct camera move (easeTo, not flyTo's zoom-out arc). Reduced motion jumps.
    map.easeTo({ center: focus.position, zoom: Math.max(map.getZoom(), 16.2), pitch: Math.max(map.getPitch(), 50), offset: offsetFor(propsRef.current.insets), duration: duration(850), essential: true });
  }, [ready, focus, duration, insetKey]);

  /* ------------------------------------------------------------ controls */
  const act = (fn: (map: MapLibreMap) => void) => () => { const map = mapRef.current; if (map) fn(map); };
  return <>
    <div ref={containerRef} className="ops-map-canvas" />
    <p id="ops-map-help" className="ops-sr-only">Map navigation: focus the map, then use arrow keys to pan, plus and minus to zoom, and Shift with arrow keys to rotate or tilt. Every case and operative can also be selected from the Cases list.</p>
    <div className="ops-camera" role="toolbar" aria-label="Map camera controls" aria-orientation="vertical">
      <button type="button" className="ops-icon-button" onClick={act((m) => m.zoomIn({ duration: duration(250) }))} aria-label="Zoom in" title="Zoom in"><Plus size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.zoomOut({ duration: duration(250) }))} aria-label="Zoom out" title="Zoom out"><Minus size={18} aria-hidden="true" /></button>
      <span className="ops-camera__rule" aria-hidden="true" />
      <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: m.getBearing() - 30, duration: duration(350) }))} aria-label="Rotate anticlockwise" title="Rotate anticlockwise"><RotateCcw size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: m.getBearing() + 30, duration: duration(350) }))} aria-label="Rotate clockwise" title="Rotate clockwise"><RotateCw size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ pitch: Math.min(MAX_PITCH, m.getPitch() + 15), duration: duration(350) }))} aria-label="Tilt towards horizon" title="Tilt up" disabled={camera.pitch >= MAX_PITCH - 0.5}><ChevronsUp size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ pitch: Math.max(0, m.getPitch() - 15), duration: duration(350) }))} aria-label="Tilt towards top-down" title="Tilt down" disabled={camera.pitch <= 0.5}><ChevronsDown size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: 0, duration: duration(450) }))} aria-label={`North up. Bearing ${Math.round(camera.bearing)} degrees`} title="North up">
        <Compass size={18} aria-hidden="true" style={{ transform: `rotate(${-camera.bearing - 45}deg)` }} />
      </button>
      <span className="ops-camera__rule" aria-hidden="true" />
      <button type="button" className="ops-icon-button" onClick={fitCases} aria-label="Show all open cases" title="Show all cases" disabled={!extent}><Focus size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={() => goHome(true)} aria-label="Reset view to central Sheffield" title="Reset view"><ScanEye size={18} aria-hidden="true" /></button>
    </div>
  </>;
}
