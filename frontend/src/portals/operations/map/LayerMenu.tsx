import { useEffect, useId, useRef, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { CollectionMetadata } from '../lib/geo';
import type { LayerVisibility } from './types';

interface Props {
  layers: LayerVisibility;
  onChange(next: LayerVisibility): void;
  online: boolean;
  basemapFailed: boolean;
  view: '3d' | '2d';
  canUse3d: boolean;
  onViewChange(view: '3d' | '2d'): void;
}

const TOGGLES: Array<{ key: keyof Omit<LayerVisibility, 'basemap'>; label: string; hint: string }> = [
  { key: 'stock', label: 'Synthetic housing stock', hint: 'Schematic columns, height by storeys' },
  { key: 'cases', label: 'Case properties', hint: 'Coloured by simulated severity' },
  { key: 'workers', label: 'Operatives', hint: 'Shift base positions' },
  { key: 'routes', label: 'Routes', hint: 'Schematic stop order, not road paths' },
];

/** One tucked-away control for layer toggles, the map key and view mode. */
export function LayerMenu({ layers, onChange, online, basemapFailed, view, canUse3d, onViewChange }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    const onPointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onPointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, [open]);

  return <div className="ops-layer-menu" ref={rootRef}>
    <button ref={buttonRef} type="button" className="ops-tool-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
      <Layers size={17} aria-hidden="true" /><span>Layers</span>
    </button>
    {open ? <div id={panelId} className="ops-popover" role="group" aria-label="Map layers and key">
      <div className="ops-popover__head"><strong>Layers</strong><button type="button" className="ops-icon-button ops-icon-button--small" onClick={() => setOpen(false)} aria-label="Close layers"><X size={16} aria-hidden="true" /></button></div>
      <fieldset className="ops-checks">
        <legend className="ops-sr-only">Visible layers</legend>
        {TOGGLES.map(({ key, label, hint }) => <label key={key} className="ops-check">
          <input type="checkbox" checked={layers[key]} onChange={(e) => onChange({ ...layers, [key]: e.target.checked })} />
          <span><span>{label}</span><small>{hint}</small></span>
        </label>)}
        <label className="ops-check">
          <input type="checkbox" checked={layers.basemap && online} disabled={!online || view === '2d'} onChange={(e) => onChange({ ...layers, basemap: e.target.checked })} />
          <span><span>Online basemap (optional)</span><small>{!online ? 'Unavailable offline; local layers continue' : basemapFailed ? 'Last attempt failed; local layers continue' : 'CARTO tiles; © OpenStreetMap contributors'}</small></span>
        </label>
      </fieldset>
      <div className="ops-segmented" role="radiogroup" aria-label="Map view">
        <button type="button" role="radio" aria-checked={view === '3d'} disabled={!canUse3d} onClick={() => onViewChange('3d')}>3D twin</button>
        <button type="button" role="radio" aria-checked={view === '2d'} onClick={() => onViewChange('2d')}>2D schematic</button>
      </div>
      <MapKey />
    </div> : null}
  </div>;
}

export function MapKey() {
  return <div className="ops-key" aria-label="Map key">
    <strong>Key</strong>
    <ul>
      <li><span className="ops-swatch ops-swatch--emergency" aria-hidden="true" />Emergency case (marked “!”)</li>
      <li><span className="ops-swatch ops-swatch--significant" aria-hidden="true" />Significant case</li>
      <li><span className="ops-swatch ops-swatch--moderate" aria-hidden="true" />Moderate case</li>
      <li><span className="ops-swatch ops-swatch--routine" aria-hidden="true" />Routine case</li>
      <li><span className="ops-swatch ops-swatch--selected" aria-hidden="true" />Selected (green ring)</li>
      <li><span className="ops-line ops-line--active" aria-hidden="true" />Approved route, solid</li>
      <li><span className="ops-line ops-line--proposed" aria-hidden="true" />Proposed route, dashed, pending approval</li>
      <li><span className="ops-swatch ops-swatch--worker" aria-hidden="true" />Operative (initials)</li>
    </ul>
  </div>;
}

/** Always-visible dataset provenance. */
export function SourceStrip({ roads, stock, basemap }: { roads: CollectionMetadata; stock: CollectionMetadata; basemap: boolean }) {
  return <p className="ops-sources">
    <span><strong>Synthetic housing stock</strong> · {stock.label} · schematic columns</span>
    <span><strong>Roads</strong> · {roads.label}{roads.attribution ? ` · ${roads.attribution}` : ''} (source: {roads.source})</span>
    <span><strong>Routes</strong> · schematic stop order, not navigation</span>
    {basemap ? <span>Basemap © OpenStreetMap contributors © CARTO</span> : null}
  </p>;
}
