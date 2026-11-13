/**
 * Offline-first MapLibre + deck.gl composition. The basemap style is a single local background layer;
 * roads, housing stock, cases, operatives and routes are all deck.gl layers built from local data.
 * Loaded lazily so the 2D fallback never pays for (or crashes on) WebGL code.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import { Compass, Minus, Plus, RotateCcw, RotateCw, ScanEye, ChevronsUp, ChevronsDown, SlidersHorizontal } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { readPalette } from '../lib/palette';
import type { CaseMarker, StopDatum, WorkerMarker } from '../lib/derive';
import type { StockUnit } from '../lib/geo';
import { SEVERITY_LABEL } from '../lib/format';
import { caseLayers, LAYER_IDS, markerScale, roadLayers, routeLayers, stockLayers, workerLayers } from './layers';
import type { MapInsets, MapViewProps } from './types';
import { useIsRoomyMap } from '../hooks/environment';

setWorkerUrl(workerUrl);

const SHEFFIELD: [number, number] = [-1.4659, 53.3811];
const HOME_PITCH = 48;
const HOME_BEARING = -14;
const MAX_PITCH = 70;
const BASEMAP_SOURCE = 'optional-basemap';
const BASEMAP_TILES = 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png';

const styleFor = (background: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'local-background', type: 'background', paint: { 'background-color': background } }],
});

function paddingFor(insets: MapInsets, container: HTMLElement | null) {
  const width = container?.clientWidth ?? 0; const height = container?.clientHeight ?? 0;
  const pad = { top: insets.top + 48, bottom: insets.bottom + 48, left: insets.left + 48, right: insets.right + 48 };
  // Never let panels consume the whole viewport, otherwise MapLibre cannot frame anything.
  if (pad.left + pad.right > width * 0.8) { const scale = (width * 0.8) / (pad.left + pad.right); pad.left *= scale; pad.right *= scale; }
  if (pad.top + pad.bottom > height * 0.8) { const scale = (height * 0.8) / (pad.top + pad.bottom); pad.top *= scale; pad.bottom *= scale; }
  return pad;
}

function tooltipText(info: PickingInfo): string | null {
  const object = info.object as unknown;
  if (!object || !info.layer) return null;
  switch (info.layer.id) {
    case LAYER_IDS.cases: { const d = object as CaseMarker; return `${d.label} · ${SEVERITY_LABEL[d.severity]}\n${d.area} (fictional location)`; }
    case LAYER_IDS.stock: { const d = object as StockUnit; return `Synthetic stock unit ${d.sourceId}\n${d.area} · ${d.floors} storeys (schematic)`; }
    case LAYER_IDS.workers: { const d = object as WorkerMarker; return `${d.name}\n${d.role}${d.busy ? ' · on active route' : ' · no active visits'}`; }
    case LAYER_IDS.activeStops: case LAYER_IDS.proposedStops: { const d = object as StopDatum; return `${d.status === 'active' ? 'Approved' : 'Proposed (pending)'} stop ${d.sequence}${d.caseId ? ` · ${d.caseId}` : ''}`; }
    default: return null;
  }
}

export default function TwinMap(props: MapViewProps) {
  const { geo, scene, extent, selection, layers, focus, resetKey, insets, reducedMotion, routeProgress, emergencyPulse, emergencyPropertyId } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const propsRef = useRef(props); propsRef.current = props;
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(11);
  const [camera, setCamera] = useState({ bearing: HOME_BEARING, pitch: HOME_PITCH });
  const roomy = useIsRoomyMap();
  const [moreControls, setMoreControls] = useState(false);
  const palette = useMemo(() => readPalette(document.querySelector('[data-portal="operations"]') ?? document.documentElement), []);
  const duration = useCallback((ms: number) => (reducedMotion ? 0 : ms), [reducedMotion]);

  /* ------------------------------------------------------------ lifecycle */
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container, style: styleFor(palette.background), center: SHEFFIELD, zoom: 11, pitch: HOME_PITCH, bearing: HOME_BEARING,
        maxPitch: MAX_PITCH, minZoom: 9, maxZoom: 18, attributionControl: false, fadeDuration: 0,
        canvasContextAttributes: { antialias: true }, reduceMotion: propsRef.current.reducedMotion || undefined,
      });
    } catch {
      propsRef.current.onFailure('The 3D map could not create a WebGL context.');
      return;
    }
    mapRef.current = map;
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-label', 'Sheffield digital twin map. Arrow keys pan, plus and minus zoom, Shift with arrow keys rotates and tilts.');
    canvas.setAttribute('aria-describedby', 'ops-map-help');

    map.on('error', (event) => {
      const message = event.error?.message ?? '';
      const sourceId = (event as { sourceId?: string }).sourceId;
      if (sourceId === BASEMAP_SOURCE || message.includes('basemaps.cartocdn.com')) { propsRef.current.onBasemapError(); return; }
      if (/webgl/i.test(message)) propsRef.current.onFailure('The WebGL renderer reported an error.');
    });
    map.on('webglcontextlost', () => propsRef.current.onFailure('The browser discarded the WebGL context (for example after a GPU reset).'));
    map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('moveend', () => setCamera({ bearing: map.getBearing(), pitch: map.getPitch() }));

    const overlay = new MapboxOverlay({
      interleaved: false, layers: [], pickingRadius: 6,
      onClick: (info: PickingInfo) => {
        const object = info.object as { propertyId?: string; id?: string; caseId?: string } | undefined;
        if (!object || !info.layer) return;
        const { onPick } = propsRef.current;
        if (info.layer.id === LAYER_IDS.cases && object.propertyId) onPick({ kind: 'property', id: object.propertyId });
        else if (info.layer.id === LAYER_IDS.stock && object.id) onPick({ kind: 'stock', id: object.id });
        else if (info.layer.id === LAYER_IDS.workers && object.id) onPick({ kind: 'worker', id: object.id });
        else if ((info.layer.id === LAYER_IDS.activeStops || info.layer.id === LAYER_IDS.proposedStops) && object.caseId) {
          const marker = propsRef.current.scene.caseMarkers.find((m) => m.caseIds.includes(object.caseId!));
          if (marker) onPick({ kind: 'property', id: marker.propertyId });
        }
      },
      getTooltip: (info: PickingInfo) => {
        const text = tooltipText(info);
        return text ? { text, className: 'ops-map-tooltip', style: { background: 'var(--graphite-850)', color: 'var(--ink-900)', border: '1px solid var(--border-strong)', borderRadius: '8px', padding: '6px 9px', font: '600 13px/1.35 "Source Sans 3", system-ui, sans-serif', whiteSpace: 'pre-line', maxWidth: '260px' } } : null;
      },
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    });
    map.addControl(overlay);
    overlayRef.current = overlay;
    map.on('load', () => setReady(true));

    return () => {
      overlayRef.current = null; mapRef.current = null;
      try { overlay.finalize(); } catch { /* already detached */ }
      map.remove();
    };
  }, [palette]);

  /* ------------------------------------------------------------ layers (memoised per group) */
  const roads = useMemo(() => roadLayers(geo.roads.items, palette), [geo.roads.items, palette]);
  const dimStock = Boolean(selection.propertyId);
  // Sizes change per half zoom level only, so pointer movement and panning never rebuild geometry.
  const zoomBucket = Math.round(zoom * 2) / 2;
  const latitude = extent ? (extent[0][1] + extent[1][1]) / 2 : SHEFFIELD[1];
  const scale = useMemo(() => markerScale(zoomBucket, latitude), [zoomBucket, latitude]);
  const stock = useMemo(() => stockLayers(geo.stock.items, palette, layers.stock, selection.stockId, dimStock, scale), [geo.stock.items, palette, layers.stock, selection.stockId, dimStock, scale]);
  const cases = useMemo(() => caseLayers(scene.caseMarkers, palette, layers.cases, selection.propertyId, emergencyPropertyId, emergencyPulse, scale), [scene.caseMarkers, palette, layers.cases, selection.propertyId, emergencyPropertyId, emergencyPulse, scale]);
  const workers = useMemo(() => workerLayers(scene.workers, palette, layers.workers, selection.workerId), [scene.workers, palette, layers.workers, selection.workerId]);
  const routes = useMemo(() => routeLayers({ active: scene.activeRoutes, activeStops: scene.activeStops, proposed: scene.proposedRoutes, proposedStops: scene.proposedStops, released: scene.releasedRoutes, progress: routeProgress, zoom: zoomBucket, latitude }, palette, layers.routes),
    [scene.activeRoutes, scene.activeStops, scene.proposedRoutes, scene.proposedStops, scene.releasedRoutes, routeProgress, zoomBucket, latitude, palette, layers.routes]);
  useEffect(() => { overlayRef.current?.setProps({ layers: [...roads, ...stock, ...routes, ...cases, ...workers] }); }, [roads, stock, routes, cases, workers]);

  /* ------------------------------------------------------------ camera */
  const frameExtent = useCallback((animate: boolean) => {
    const map = mapRef.current; if (!map || !extent) return;
    // Fit top-down, then tilt: MapLibre's pitched fit is conservative and leaves the twin small.
    const target = map.cameraForBounds(extent, { padding: paddingFor(propsRef.current.insets, containerRef.current), bearing: HOME_BEARING });
    if (!target) return;
    const center = target.center; const bearing = HOME_BEARING; const pitch = HOME_PITCH;
    const z = (target.zoom ?? 11) + 0.4;
    if (animate && !propsRef.current.reducedMotion) map.easeTo({ center, zoom: z, bearing, pitch, duration: 800, essential: true });
    else map.jumpTo({ center, zoom: z, bearing, pitch });
  }, [extent]);

  const framed = useRef(false);
  useEffect(() => { if (ready && extent && !framed.current) { framed.current = true; frameExtent(false); } }, [ready, extent, frameExtent]);
  const lastReset = useRef(resetKey);
  useEffect(() => { if (ready && resetKey !== lastReset.current) { lastReset.current = resetKey; frameExtent(true); } }, [ready, resetKey, frameExtent]);

  const lastFocus = useRef<{ key: number; at: number; insets: string } | null>(null);
  const insetKey = `${insets.left}:${insets.right}:${insets.top}:${insets.bottom}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const fresh = focus.key !== lastFocus.current?.key;
    // Panels that open together with a selection (inspector, drawer) are measured a frame later;
    // re-centre once if they change the visible area shortly after the focus request.
    const settling = !fresh && lastFocus.current && lastFocus.current.insets !== insetKey && performance.now() - lastFocus.current.at < 1200;
    if (!fresh && !settling) return;
    lastFocus.current = { key: focus.key, at: fresh ? performance.now() : lastFocus.current!.at, insets: insetKey };
    const { left, right, top, bottom } = propsRef.current.insets;
    // easeTo (not flyTo) keeps the movement short and direct instead of zooming out and back in.
    map.easeTo({ center: focus.position, zoom: Math.max(map.getZoom(), 13.4), offset: [(left - right) / 2, (top - bottom) / 2], duration: duration(750), essential: true });
  }, [ready, focus, duration, insetKey]);

  /* ------------------------------------------------------------ optional online basemap */
  useEffect(() => {
    const map = mapRef.current; if (!ready || !map) return;
    const present = Boolean(map.getSource(BASEMAP_SOURCE));
    if (layers.basemap && !present) {
      map.addSource(BASEMAP_SOURCE, { type: 'raster', tiles: [BASEMAP_TILES], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors © CARTO' });
      map.addLayer({ id: BASEMAP_SOURCE, type: 'raster', source: BASEMAP_SOURCE, paint: { 'raster-opacity': 0.55 } });
    } else if (!layers.basemap && present) {
      if (map.getLayer(BASEMAP_SOURCE)) map.removeLayer(BASEMAP_SOURCE);
      map.removeSource(BASEMAP_SOURCE);
    }
  }, [ready, layers.basemap]);

  /* ------------------------------------------------------------ controls */
  const act = (fn: (map: MapLibreMap) => void) => () => { const map = mapRef.current; if (map) fn(map); };
  const showAdvanced = roomy || moreControls;
  return <>
    <div ref={containerRef} className="ops-map-canvas" />
    <p id="ops-map-help" className="ops-sr-only">Map navigation: focus the map, then use arrow keys to pan, plus and minus to zoom, and Shift with arrow keys to rotate or tilt. Every case and operative on the map can also be selected from the case list.</p>
    <div className="ops-camera" role="toolbar" aria-label="Map camera controls" aria-orientation="vertical">
      <button type="button" className="ops-icon-button" onClick={act((m) => m.zoomIn({ duration: duration(250) }))} aria-label="Zoom in" title="Zoom in"><Plus size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={act((m) => m.zoomOut({ duration: duration(250) }))} aria-label="Zoom out" title="Zoom out"><Minus size={18} aria-hidden="true" /></button>
      {showAdvanced ? <>
        <span className="ops-camera__rule" aria-hidden="true" />
        <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: m.getBearing() - 30, duration: duration(350) }))} aria-label="Rotate anticlockwise" title="Rotate anticlockwise"><RotateCcw size={18} aria-hidden="true" /></button>
        <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: m.getBearing() + 30, duration: duration(350) }))} aria-label="Rotate clockwise" title="Rotate clockwise"><RotateCw size={18} aria-hidden="true" /></button>
        <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ pitch: Math.min(MAX_PITCH, m.getPitch() + 15), duration: duration(350) }))} aria-label="Tilt towards horizon" title="Tilt up (more 3D)" disabled={camera.pitch >= MAX_PITCH - 0.5}><ChevronsUp size={18} aria-hidden="true" /></button>
        <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ pitch: Math.max(0, m.getPitch() - 15), duration: duration(350) }))} aria-label="Tilt towards top-down" title="Tilt down (flatter)" disabled={camera.pitch <= 0.5}><ChevronsDown size={18} aria-hidden="true" /></button>
        <button type="button" className="ops-icon-button" onClick={act((m) => m.easeTo({ bearing: 0, pitch: 0, duration: duration(450) }))} aria-label={`Reset to north, top-down. Bearing ${Math.round(camera.bearing)} degrees, tilt ${Math.round(camera.pitch)} degrees`} title="North up, top-down">
          <Compass size={18} aria-hidden="true" style={{ transform: `rotate(${-camera.bearing - 45}deg)` }} />
        </button>
      </> : null}
      {!roomy ? <button type="button" className="ops-icon-button" aria-expanded={moreControls} onClick={() => setMoreControls((v) => !v)} aria-label={moreControls ? 'Fewer camera controls' : 'More camera controls'} title="Camera controls"><SlidersHorizontal size={18} aria-hidden="true" /></button> : null}
      <span className="ops-camera__rule" aria-hidden="true" />
      <button type="button" className="ops-icon-button" onClick={() => frameExtent(true)} aria-label="Reset view to the whole fixture extent" title="Reset view"><ScanEye size={18} aria-hidden="true" /></button>
    </div>
  </>;
}
