import { useId, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PanelTab { id: string; label: string; badge?: ReactNode; content: ReactNode; }

interface Props {
  side: 'left' | 'right';
  label: string;
  tabs: PanelTab[];
  active: string;
  onActiveChange(id: string): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  collapsedLabel: string;
  /** Changing this resets the panel's scroll position (e.g. a new selection). */
  contentKey?: string;
}

/** Collapsible side panel with ARIA tabs. Collapsed, it leaves a slim, labelled strip to reopen it. */
export function SidePanel({ side, label, tabs, active, onActiveChange, open, onOpenChange, collapsedLabel, contentKey }: Props) {
  const baseId = useId();
  const Collapse = side === 'left' ? ChevronLeft : ChevronRight;
  const Expand = side === 'left' ? ChevronRight : ChevronLeft;
  if (!open) {
    return <div className={`ops-panel-strip ops-panel-strip--${side}`}>
      <button type="button" className="ops-strip-button" onClick={() => onOpenChange(true)} aria-label={`Show ${collapsedLabel}`} title={`Show ${collapsedLabel}`}>
        <Expand size={17} aria-hidden="true" /><span>{collapsedLabel}</span>
      </button>
    </div>;
  }
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.id === current.id);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!;
    onActiveChange(next.id);
    document.getElementById(`${baseId}-${next.id}`)?.focus();
  };
  return <section className={`ops-side ops-side--${side}`} aria-label={label}>
    <header className="ops-side__head">
      <div role="tablist" aria-label={label} className="ops-tabs" onKeyDown={onKeyDown}>
        {tabs.map((tab) => <button key={tab.id} id={`${baseId}-${tab.id}`} type="button" role="tab" aria-selected={tab.id === current.id} aria-controls={`${baseId}-${tab.id}-panel`} tabIndex={tab.id === current.id ? 0 : -1} onClick={() => onActiveChange(tab.id)}>
          {tab.label}{tab.badge}
        </button>)}
      </div>
      <button type="button" className="ops-icon-button ops-icon-button--small" onClick={() => onOpenChange(false)} aria-label={`Hide ${collapsedLabel}`} title={`Hide ${collapsedLabel}`}><Collapse size={17} aria-hidden="true" /></button>
    </header>
    <div key={`${current.id}:${contentKey ?? ''}`} id={`${baseId}-${current.id}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${current.id}`} className="ops-side__body">{current.content}</div>
  </section>;
}
