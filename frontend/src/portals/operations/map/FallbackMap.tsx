/**
 * 2D schematic used when WebGL cannot start. Pure SVG, coloured only through CSS tokens,
 * so the case list, inspector, schedule and approvals all stay fully usable.
 */
import { memo, useMemo } from 'react';
import { MonitorX } from 'lucide-react';
import type { Bounds, LonLat } from '../lib/geo';
import { SEVERITY_LABEL } from '../lib/format';
import type { MapViewProps } from './types';

const WIDTH = 1000;

function projector(extent: Bounds) {
  const [[minLon, minLat], [maxLon, maxLat]] = extent;
  const padLon = (maxLon - minLon) * 0.04; const padLat = (maxLat - minLat) * 0.04;
  const x0 = minLon - padLon; const x1 = maxLon + padLon; const y0 = minLat - padLat; const y1 = maxLat + padLat;
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const scale = WIDTH / ((x1 - x0) * k);
  const height = Math.round((y1 - y0) * scale);
  const project = ([lon, lat]: LonLat): [number, number] => [Number(((lon - x0) * k * scale).toFixed(1)), Number(((y1 - lat) * scale).toFixed(1))];
  return { project, height };
}

const points = (path: LonLat[], project: (p: LonLat) => [number, number]) => path.map((p) => project(p).join(',')).join(' ');

type Props = Pick<MapViewProps, 'geo' | 'scene' | 'extent' | 'selection' | 'layers' | 'onPick'> & { reason: string | null; onRetry?: () => void };

export const FallbackMap = memo(function FallbackMap({ geo, scene, extent, selection, layers, onPick, reason, onRetry }: Props) {
  const projection = useMemo(() => (extent ? projector(extent) : null), [extent]);
  const base = useMemo(() => {
    if (!projection) return null;
    const { project } = projection;
    return <>
      <g className="ops-fallback__roads" aria-hidden="true">{geo.roads.items.map((road) => <polyline key={road.id} points={points(road.path, project)} />)}</g>
      {layers.stock ? <g className="ops-fallback__stock" aria-hidden="true">{geo.stock.items.map((unit) => { const [x, y] = project(unit.position); return <circle key={unit.id} cx={x} cy={y} r={3.6} data-selected={unit.id === selection.stockId || undefined} onClick={() => onPick({ kind: 'stock', id: unit.id })} />; })}</g> : null}
    </>;
  }, [projection, geo, layers.stock, selection.stockId, onPick]);
  if (!projection) return null;
  const { project, height } = projection;

  return <div className="ops-fallback">
    <div className="ops-fallback__notice" role="status">
      <MonitorX size={18} aria-hidden="true" />
      <p><strong>2D schematic view.</strong> {reason ?? 'The 3D twin is unavailable.'} Cases, schedules and approvals work normally from the lists.</p>
      {onRetry ? <button type="button" className="ops-text-button" onClick={onRetry}>Try 3D again</button> : null}
    </div>
    <svg className="ops-fallback__svg" viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Schematic 2D overview of synthetic Sheffield housing stock, open cases, operatives and routes">
      {base}
      {layers.routes ? <g aria-hidden="true">
        {scene.activeRoutes.map((route) => <polyline key={route.id} className="ops-fallback__route ops-fallback__route--active" points={points(route.path, project)} />)}
        {scene.proposedRoutes.map((route) => <polyline key={route.id} className="ops-fallback__route ops-fallback__route--proposed" points={points(route.path, project)} />)}
        {[...scene.activeStops, ...scene.proposedStops].map((stop) => { const [x, y] = project(stop.position); return <g key={stop.id} className={`ops-fallback__stop ops-fallback__stop--${stop.status}`}><circle cx={x} cy={y} r={13} /><text x={x} y={y + 5}>{stop.sequence}</text></g>; })}
      </g> : null}
      {layers.cases ? <g>
        {scene.caseMarkers.map((marker) => {
          const [x, y] = project(marker.position); const selected = marker.propertyId === selection.propertyId;
          return <g key={marker.propertyId} className="ops-fallback__case" data-severity={marker.severity} data-selected={selected || undefined} onClick={() => onPick({ kind: 'property', id: marker.propertyId })}>
            <title>{`${marker.label}, ${SEVERITY_LABEL[marker.severity]}, ${marker.area}`}</title>
            {selected ? <circle className="ops-fallback__ring" cx={x} cy={y} r={26} /> : null}
            {marker.emergency ? <path d={`M ${x} ${y - 19} L ${x + 19} ${y} L ${x} ${y + 19} L ${x - 19} ${y} Z`} /> : <circle cx={x} cy={y} r={13} />}
            {marker.emergency || selected ? <text x={x} y={y - 30}>{marker.emergency ? `! ${marker.label}` : marker.label}</text> : null}
          </g>;
        })}
      </g> : null}
      {layers.workers ? <g>
        {scene.workers.map((worker) => { const [x, y] = project(worker.position); return <g key={worker.id} className="ops-fallback__worker" data-busy={worker.busy || undefined} data-selected={worker.id === selection.workerId || undefined} onClick={() => onPick({ kind: 'worker', id: worker.id })}>
          <title>{`${worker.name}, ${worker.role}`}</title><rect x={x - 16} y={y - 16} width={32} height={32} rx={6} /><text x={x} y={y + 5}>{worker.initials}</text>
        </g>; })}
      </g> : null}
    </svg>
  </div>;
});
