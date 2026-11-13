import { straightLineKm } from './model';

type Point = { lat: number; lon: number };
interface Props { start: Point; startLabel: string; stops: Array<Point & { id: string; label: string; current: boolean }>; }

const W = 320; const H = 150; const PAD = 22;

/** Offline schematic: straight lines between points, not a road route. */
export function RoutePreview({ start, startLabel, stops }: Props) {
  const points = [start, ...stops];
  const cos = Math.cos((start.lat * Math.PI) / 180);
  const xs = points.map((p) => p.lon * cos); const ys = points.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - PAD * 2) / (maxX - minX || 1e-3), (H - PAD * 2) / (maxY - minY || 1e-3));
  const offX = (W - (maxX - minX) * scale) / 2; const offY = (H - (maxY - minY) * scale) / 2;
  const project = (p: Point) => [offX + (p.lon * cos - minX) * scale, H - (offY + (p.lat - minY) * scale)] as const;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' ');
  const current = stops.find((s) => s.current);
  const prev = current ? points[points.indexOf(current) - 1] : undefined;
  const km = current && prev ? straightLineKm(prev, current) : null;

  return <figure className="op-route">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Schematic route from ${startLabel} through ${stops.length} stop${stops.length === 1 ? '' : 's'}${km !== null ? `; next stop about ${km.toFixed(1)} kilometres in a straight line` : ''}.`}>
      <path d={path} className="op-route__line" />
      {(() => { const [x, y] = project(start); return <rect x={x - 6} y={y - 6} width={12} height={12} className="op-route__start" />; })()}
      {stops.map((s, i) => { const [x, y] = project(s); return <g key={s.id} className={s.current ? 'op-route__stop is-current' : 'op-route__stop'}>
        <circle cx={x} cy={y} r={s.current ? 11 : 8} /><text x={x} y={y + 4} textAnchor="middle">{i + 1}</text>
      </g>; })}
    </svg>
    <figcaption>
      <span><span className="op-route__key op-route__key--start" aria-hidden="true" />{startLabel}</span>
      {km !== null && <span>≈ {km.toFixed(1)} km straight-line to next stop</span>}
      <span className="op-route__note">Schematic only: straight lines, not a road route or turn-by-turn directions.</span>
    </figcaption>
  </figure>;
}
