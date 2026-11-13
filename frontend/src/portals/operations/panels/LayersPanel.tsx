import { useId } from 'react';
import { HAZARD_LABEL, SEVERITY_LABEL } from '../lib/format';
import type { HazardType, Severity } from '../../../shared/types/domain';
import type { LocalMapData } from '../hooks/useLocalMapData';
import type { ActiveSource, DataPreference, LayerVisibility } from '../map/types';

interface Props {
  layers: LayerVisibility;
  onChange(next: LayerVisibility): void;
  dataPreference: DataPreference;
  onDataPreferenceChange(next: DataPreference): void;
  activeSource: ActiveSource;
  local: LocalMapData | null;
  view: '3d' | '2d';
  canUse3d: boolean;
  onViewChange(view: '3d' | '2d'): void;
}

const TOGGLES: Array<{ key: keyof LayerVisibility; label: string; hint: string }> = [
  { key: 'buildings', label: '3D buildings', hint: 'OpenStreetMap footprints at true height' },
  { key: 'caseBuildings', label: 'Case buildings', hint: 'Coloured by severity' },
  { key: 'hazards', label: 'Hazard columns', hint: 'Coloured by hazard type' },
  { key: 'density', label: 'Case density', hint: 'Hexagons, 280 m across' },
  { key: 'operatives', label: 'Operatives', hint: 'Shift start positions' },
  { key: 'routes', label: 'Routes', hint: 'Ordered stops, not turn-by-turn directions' },
  { key: 'labels', label: 'Place and street labels', hint: 'Neighbourhoods and streets' },
];
const SEVERITIES: Severity[] = ['emergency', 'significant', 'moderate', 'routine'];
const HAZARDS: HazardType[] = ['gas', 'fire', 'electrical', 'leak', 'damp_mould', 'other'];

export function LayersPanel({ layers, onChange, dataPreference, onDataPreferenceChange, activeSource, local, view, canUse3d, onViewChange }: Props) {
  const sourceId = useId();
  const hasLocal = Boolean(local?.buildings || local?.roads);
  return <div className="ops-layers">
    <fieldset className="ops-checks">
      <legend>Layers</legend>
      {TOGGLES.map(({ key, label, hint }) => <label key={key} className="ops-check">
        <input type="checkbox" checked={layers[key]} onChange={(e) => onChange({ ...layers, [key]: e.target.checked })} disabled={view === '2d' && (key === 'density' || key === 'labels')} />
        <span><span>{label}</span><small>{hint}</small></span>
      </label>)}
    </fieldset>

    <div className="ops-layers__group">
      <span className="ops-layers__heading">View</span>
      <div className="ops-segmented" role="radiogroup" aria-label="Map view">
        <button type="button" role="radio" aria-checked={view === '3d'} disabled={!canUse3d} onClick={() => onViewChange('3d')}>3D</button>
        <button type="button" role="radio" aria-checked={view === '2d'} onClick={() => onViewChange('2d')}>2D</button>
      </div>
    </div>

    <div className="ops-layers__group">
      <label className="ops-layers__heading" htmlFor={sourceId}>Map data</label>
      <select id={sourceId} value={dataPreference} onChange={(e) => onDataPreferenceChange(e.target.value as DataPreference)}>
        <option value="auto">Automatic (online tiles, local files when offline)</option>
        <option value="tiles">OpenFreeMap online tiles</option>
        <option value="local" disabled={!hasLocal}>Local Sheffield files{hasLocal ? '' : ' (not installed)'}</option>
      </select>
      <p className="ops-note" role="status">
        {view === '2d' ? (hasLocal ? 'The 2D view uses the local Sheffield files.' : 'Local Sheffield files are not installed, so the 2D view shows cases and routes only.')
          : activeSource === 'tiles' ? 'Showing OpenFreeMap vector tiles.' : activeSource === 'local' ? 'Showing local Sheffield files (offline-capable).' : 'No street data available: online tiles failed and local files are not installed.'}
      </p>
    </div>

    <div className="ops-key" aria-label="Map key">
      <span className="ops-layers__heading">Severity (case buildings)</span>
      <ul>{SEVERITIES.map((s) => <li key={s}><span className="ops-swatch" data-severity={s} aria-hidden="true" />{SEVERITY_LABEL[s]}{s === 'emergency' ? ' (labelled “!”)' : ''}</li>)}</ul>
      <span className="ops-layers__heading">Hazard type (columns)</span>
      <ul>{HAZARDS.map((h) => <li key={h}><span className="ops-swatch ops-swatch--column" data-hazard={h} aria-hidden="true" />{HAZARD_LABEL[h]}</li>)}</ul>
      <span className="ops-layers__heading">Routes</span>
      <ul>
        <li><span className="ops-line ops-line--active" aria-hidden="true" />Approved route, solid</li>
        <li><span className="ops-line ops-line--proposed" aria-hidden="true" />Proposed route, dashed: shown while reviewing in Schedule</li>
        <li><span className="ops-swatch ops-swatch--selected" aria-hidden="true" />Selected case (green ring)</li>
      </ul>
    </div>
  </div>;
}

/** Licence attribution for whichever street data is on screen. Always visible. */
export function Attribution({ source, local }: { source: ActiveSource | '2d'; local: LocalMapData | null }) {
  const localNote = local?.buildings?.metadata.attribution ?? local?.roads?.metadata.attribution;
  return <p className="ops-attribution">
    {source === 'tiles' ? <>
      <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{' '}
      <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> Data from{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
    </> : source === 'local' || (source === '2d' && localNote) ? <>
      Local data: {localNote ?? '© OpenStreetMap contributors'} · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Licence</a>
    </> : <>No street data loaded</>}
    <span> · Routes join ordered stops</span>
  </p>;
}
