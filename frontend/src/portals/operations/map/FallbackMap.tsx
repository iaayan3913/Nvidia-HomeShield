/**
 * 2D fallback when WebGL cannot start: a canvas map of the same local Sheffield roads, building outlines,
 * cases, operatives and routes, with drag/wheel/pinch/keyboard/button pan and zoom. Colours come from tokens.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, MonitorX, Plus, ScanEye } from 'lucide-react';
import { mercator, outerRings, type LonLat } from '../lib/geo';
import { css, readPalette, type MapPalette } from '../lib/palette';
import { fitView, panBy, toScreen, viewAt, zoomAt, zoomOf, type View2D } from '../lib/view2d';
import { HOME_VIEW, type MapViewProps } from './types';

type Props = Pick<MapViewProps, 'local' | 'scene' | 'extent' | 'selection' | 'layers' | 'onPick' | 'theme' | 'focus' | 'resetKey' | 'fitKey'> & { reason: string | null; onRetry?: () => void };
type Projected = Float64Array; // [x0, y0, x1, y1, ...] in mercator units

const projectPath = (path: LonLat[]): Projected => { const out = new Float64Array(path.length * 2); path.forEach((p, i) => { const [x, y] = mercator(p); out[i * 2] = x; out[i * 2 + 1] = y; }); return out; };

export const FallbackMap = memo(function FallbackMap({ local, scene, extent, selection, layers, onPick, theme, focus, resetKey, fitKey, reason, onRetry }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<View2D>(() => viewAt(HOME_VIEW.center, 14));
  const palette = useMemo<MapPalette>(() => readPalette(document.querySelector('.ops')), [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-project local geometry once.
  const roads = useMemo(() => (local.roads?.features ?? []).flatMap((f) => (f.geometry.type === 'LineString' ? [{ kind: String(f.properties.highway ?? ''), path: projectPath(f.geometry.coordinates as LonLat[]) }] : [])), [local.roads]);
  const buildings = useMemo(() => (local.buildings?.features ?? []).flatMap((f) => outerRings(f.geometry).map(projectPath)), [local.buildings]);

  useEffect(() => {
    const element = wrapRef.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const home = useCallback(() => setView(viewAt(HOME_VIEW.center, 14.2)), []);
  const lastReset = useRef(resetKey); useEffect(() => { if (resetKey !== lastReset.current) { lastReset.current = resetKey; home(); } }, [resetKey, home]);
  const lastFit = useRef(fitKey); useEffect(() => { if (fitKey !== lastFit.current && extent) { lastFit.current = fitKey; setView(fitView(extent, size.width, size.height, 60)); } }, [fitKey, extent, size]);
  const lastFocus = useRef<number | null>(null);
  useEffect(() => { if (focus && focus.key !== lastFocus.current) { lastFocus.current = focus.key; setView((v) => ({ ...viewAt(focus.position, Math.max(zoomOf(v), 15.5)) })); } }, [focus]);

  /* ------------------------------------------------------------ drawing */
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio); canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { width, height } = size;
    const sx = (x: number) => (x - view.cx) * view.scale + width / 2;
    const sy = (y: number) => (y - view.cy) * view.scale + height / 2;
    const tracePath = (path: Projected, close = false) => { ctx.beginPath(); ctx.moveTo(sx(path[0]!), sy(path[1]!)); for (let i = 2; i < path.length; i += 2) ctx.lineTo(sx(path[i]!), sy(path[i + 1]!)); if (close) ctx.closePath(); };
    const visible = (path: Projected) => { const x = sx(path[0]!), y = sy(path[1]!); return x > -400 && x < width + 400 && y > -400 && y < height + 400; };
    ctx.fillStyle = css(palette.land); ctx.fillRect(0, 0, width, height);
    const zoom = zoomOf(view);

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const road of roads) {
      if (!visible(road.path)) continue;
      const major = ['motorway', 'trunk', 'primary'].includes(road.kind); const mid = ['secondary', 'tertiary'].includes(road.kind);
      if (!major && !mid && zoom < 13.5) continue;
      ctx.strokeStyle = css(major ? palette.roadMajor : mid ? palette.road : palette.roadMinor);
      ctx.lineWidth = Math.max(0.6, (major ? 3 : mid ? 2 : 1.1) * 2 ** (zoom - 15)); tracePath(road.path); ctx.stroke();
    }
    if (layers.buildings && zoom >= 14) {
      ctx.fillStyle = css(palette.building); ctx.strokeStyle = css(palette.buildingEdge); ctx.lineWidth = 0.6;
      for (const ring of buildings) { if (!visible(ring)) continue; tracePath(ring, true); ctx.fill(); if (zoom >= 16) ctx.stroke(); }
    }
    if (layers.routes) {
      const drawRoute = (path: LonLat[], colour: string, dashed: boolean) => { const p = projectPath(path); ctx.setLineDash(dashed ? [10, 7] : []); ctx.strokeStyle = css(palette.labelHalo); ctx.lineWidth = 7; tracePath(p); ctx.stroke(); ctx.strokeStyle = colour; ctx.lineWidth = 3.5; tracePath(p); ctx.stroke(); };
      scene.activeRoutes.forEach((r) => drawRoute(r.path, css(palette.active), false));
      scene.proposedRoutes.forEach((r) => drawRoute(r.path, css(palette.proposed), true));
      ctx.setLineDash([]);
      for (const stop of [...scene.activeStops, ...scene.proposedStops]) {
        const [x, y] = toScreen(mercator(stop.position), view, width, height);
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = css(stop.status === 'active' ? palette.active : palette.labelHalo); ctx.fill();
        ctx.strokeStyle = css(stop.status === 'active' ? palette.labelHalo : palette.proposed); ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = css(stop.status === 'active' ? palette.labelHalo : palette.proposed); ctx.font = '700 11px "Source Sans 3", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(stop.sequence), x, y);
      }
    }
    if (layers.caseBuildings || layers.hazards) {
      for (const marker of scene.caseMarkers) {
        const [x, y] = toScreen(mercator(marker.position), view, width, height); const selected = marker.propertyId === selection.propertyId;
        ctx.fillStyle = css(palette.severity[marker.severity]); ctx.strokeStyle = css(palette.labelHalo); ctx.lineWidth = 2;
        ctx.beginPath();
        if (marker.emergency) { ctx.moveTo(x, y - 13); ctx.lineTo(x + 13, y); ctx.lineTo(x, y + 13); ctx.lineTo(x - 13, y); ctx.closePath(); } else ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        if (selected) { ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.strokeStyle = css(palette.selected); ctx.lineWidth = 3; ctx.stroke(); }
        if (selected || marker.emergency) {
          ctx.font = '700 12px "Source Sans 3", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 4; ctx.strokeStyle = css(palette.labelHalo); const text = marker.emergency ? `! ${marker.label}` : marker.label;
          ctx.strokeText(text, x, y - 22); ctx.fillStyle = css(selected ? palette.selected : palette.label); ctx.fillText(text, x, y - 22);
        }
      }
    }
    if (layers.operatives) {
      for (const worker of scene.workers) {
        const [x, y] = toScreen(mercator(worker.position), view, width, height); const selected = worker.id === selection.workerId;
        ctx.fillStyle = css(palette.labelHalo); ctx.strokeStyle = css(selected ? palette.selected : worker.busy ? palette.active : palette.operativeIdle); ctx.lineWidth = selected ? 3 : 2;
        ctx.beginPath(); ctx.roundRect(x - 12, y - 12, 24, 24, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = css(palette.operative); ctx.font = '700 10px "Source Sans 3", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(worker.initials, x, y);
      }
    }
  }, [size, view, palette, roads, buildings, scene, selection, layers]);

  /* ------------------------------------------------------------ interaction */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const local2d = (event: { clientX: number; clientY: number }) => { const rect = canvasRef.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => { event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, local2d(event)); moved.current = false; };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const previous = pointers.current.get(event.pointerId); if (!previous) return;
    const point = local2d(event);
    if (pointers.current.size === 1) {
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0) { moved.current = true; setView((v) => panBy(v, point.x - previous.x, point.y - previous.y)); }
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y); const after = Math.hypot(point.x - other.x, point.y - other.y);
      if (before > 0) { moved.current = true; setView((v) => zoomAt(v, after / before, (point.x + other.x) / 2, (point.y + other.y) / 2, size.width, size.height)); }
    }
    pointers.current.set(event.pointerId, point);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasSingle = pointers.current.size === 1; pointers.current.delete(event.pointerId);
    if (!wasSingle || moved.current) return;
    const { x, y } = local2d(event);
    const hit = <T,>(items: T[], position: (item: T) => LonLat, radius: number) => items.find((item) => { const [px, py] = toScreen(mercator(position(item)), view, size.width, size.height); return Math.hypot(px - x, py - y) <= radius; });
    const marker = (layers.caseBuildings || layers.hazards) ? hit(scene.caseMarkers, (m) => m.position, 16) : undefined;
    if (marker) { onPick({ kind: 'property', id: marker.propertyId }); return; }
    const worker = layers.operatives ? hit(scene.workers, (w) => w.position, 15) : undefined;
    if (worker) onPick({ kind: 'worker', id: worker.id });
  };
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    // Non-passive wheel listener so the page does not scroll while zooming.
    const onWheel = (event: WheelEvent) => { event.preventDefault(); const { x, y } = local2d(event); setView((v) => zoomAt(v, Math.exp(-event.deltaY * 0.0015), x, y, canvas.clientWidth, canvas.clientHeight)); };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = 80; const centre = [size.width / 2, size.height / 2] as const;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => setView((v) => panBy(v, step, 0)), ArrowRight: () => setView((v) => panBy(v, -step, 0)),
      ArrowUp: () => setView((v) => panBy(v, 0, step)), ArrowDown: () => setView((v) => panBy(v, 0, -step)),
      '+': () => setView((v) => zoomAt(v, 1.5, ...centre, size.width, size.height)), '=': () => setView((v) => zoomAt(v, 1.5, ...centre, size.width, size.height)),
      '-': () => setView((v) => zoomAt(v, 1 / 1.5, ...centre, size.width, size.height)), '0': home,
    };
    const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
  };
  const zoomButton = (factor: number) => () => setView((v) => zoomAt(v, factor, size.width / 2, size.height / 2, size.width, size.height));

  return <div className="ops-fallback" ref={wrapRef}>
    <canvas ref={canvasRef} className="ops-fallback__canvas" tabIndex={0} role="img" aria-label="2D map of central Sheffield with open cases, operatives and routes. Drag or use arrow keys to pan; scroll, pinch or use plus and minus to zoom; 0 resets."
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={(e) => pointers.current.delete(e.pointerId)} onKeyDown={onKeyDown}
      style={{ width: size.width, height: size.height }} />
    <div className="ops-fallback__notice" role="status">
      <MonitorX size={18} aria-hidden="true" />
      <p><strong>2D view.</strong> {reason ?? 'The 3D twin is unavailable.'}</p>
      {onRetry ? <button type="button" className="ops-text-button" onClick={onRetry}>Try 3D again</button> : null}
    </div>
    <div className="ops-camera" role="toolbar" aria-label="2D map controls" aria-orientation="vertical">
      <button type="button" className="ops-icon-button" onClick={zoomButton(1.5)} aria-label="Zoom in" title="Zoom in"><Plus size={18} aria-hidden="true" /></button>
      <button type="button" className="ops-icon-button" onClick={zoomButton(1 / 1.5)} aria-label="Zoom out" title="Zoom out"><Minus size={18} aria-hidden="true" /></button>
      <span className="ops-camera__rule" aria-hidden="true" />
      <button type="button" className="ops-icon-button" onClick={home} aria-label="Reset view to central Sheffield" title="Reset view"><ScanEye size={18} aria-hidden="true" /></button>
    </div>
  </div>;
});
