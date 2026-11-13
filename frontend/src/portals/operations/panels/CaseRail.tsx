import { memo, useId, useRef } from 'react';
import { BellRing, ChevronLeft, Search, UserRound, X } from 'lucide-react';
import { StatusBadge } from '../../../shared/components/Status';
import type { CaseFilters, CaseRow, StatusFilter, UrgencyFilter } from '../lib/derive';
import { HAZARD_LABEL, plural } from '../lib/format';

interface Props {
  rows: CaseRow[];
  totalCount: number;
  filters: CaseFilters;
  onFiltersChange(next: CaseFilters): void;
  selectedCaseId: string | null;
  onSelect(caseId: string): void;
  arrivals: string[];
  onDismissArrivals(): void;
  onClose(): void;
}

const URGENCY: Array<[UrgencyFilter, string]> = [['all', 'All urgencies'], ['emergency', 'Emergency'], ['significant', 'Significant'], ['moderate', 'Moderate'], ['routine', 'Routine']];
const STATUS: Array<[StatusFilter, string]> = [['all', 'All statuses'], ['needs_action', 'Needs action'], ['unassigned', 'No active visit'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['resolved', 'Resolved']];

export const CaseRail = memo(function CaseRail({ rows, totalCount, filters, onFiltersChange, selectedCaseId, onSelect, arrivals, onDismissArrivals, onClose }: Props) {
  const searchId = useId(); const urgencyId = useId(); const statusId = useId(); const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = filters.query || filters.urgency !== 'all' || filters.status !== 'all';

  // Arrow keys move between case buttons; Tab still leaves the list.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.ops-case-row') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
    if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
  };

  return <section className="ops-rail" aria-labelledby={headingId}>
    <header className="ops-panel-head">
      <h2 id={headingId}>Cases <span className="ops-count">{rows.length}{filtered ? ` of ${totalCount}` : ''}</span></h2>
      <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onClose} aria-label="Hide case list" title="Hide case list"><ChevronLeft size={18} aria-hidden="true" /></button>
    </header>
    <div className="ops-rail__filters">
      <label htmlFor={searchId} className="ops-sr-only">Search cases</label>
      <div className="ops-search">
        <Search size={16} aria-hidden="true" />
        <input id={searchId} type="search" placeholder="Search reference, problem, area, operative" value={filters.query} onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })} />
      </div>
      <div className="ops-rail__selects">
        <div><label htmlFor={urgencyId}>Urgency</label>
          <select id={urgencyId} value={filters.urgency} onChange={(e) => onFiltersChange({ ...filters, urgency: e.target.value as UrgencyFilter })}>{URGENCY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor={statusId}>Status</label>
          <select id={statusId} value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as StatusFilter })}>{STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
    </div>
    <div aria-live="polite" className="ops-rail__live">
      {arrivals.length ? <div className="ops-arrivals">
        <BellRing size={16} aria-hidden="true" />
        <p>{plural(arrivals.length, 'new case')} received: {arrivals.map((id, i) => <span key={id}>{i ? ', ' : ''}<button type="button" className="ops-text-button" onClick={() => onSelect(id)}>Locate {id}</button></span>)}</p>
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onDismissArrivals} aria-label="Dismiss new case notice"><X size={15} aria-hidden="true" /></button>
      </div> : null}
    </div>
    {rows.length ? <ul className="ops-case-list" ref={listRef} onKeyDown={onListKeyDown} aria-label="Case list. Use up and down arrow keys to move between cases.">
      {rows.map((row) => {
        const selected = row.case.id === selectedCaseId;
        return <li key={row.case.id}>
          <button type="button" className="ops-case-row" aria-pressed={selected} data-severity={row.case.severity} onClick={() => onSelect(row.case.id)}>
            <span className="ops-case-row__top">
              <span className="ops-case-row__ref">{row.case.is_emergency ? <span className="ops-emergency-flag" aria-hidden="true">!</span> : null}{row.case.id}</span>
              <StatusBadge value={row.case.severity} />
              <StatusBadge value={row.case.status} />
            </span>
            <span className="ops-case-row__problem"><strong>{HAZARD_LABEL[row.case.hazard_type]}</strong> · {row.case.summary}</span>
            <span className="ops-case-row__meta">
              <span>{row.property?.area ?? 'Unknown area'}</span>
              <span data-tone={row.due.tone}>{row.due.label}{row.due.reviewRequired ? ' · review' : ''}</span>
            </span>
            <span className="ops-case-row__worker"><UserRound size={14} aria-hidden="true" />{row.worker ? row.worker.name : row.pendingWorker ? `Proposed: ${row.pendingWorker.name} (pending)` : 'No active operative'}</span>
          </button>
        </li>;
      })}
    </ul> : <div className="ops-empty">
      <p>{totalCount ? 'No cases match these filters.' : 'No cases yet. New resident reports appear here automatically.'}</p>
      {filtered ? <button type="button" className="ops-text-button" onClick={() => onFiltersChange({ query: '', urgency: 'all', status: 'all' })}>Clear filters</button> : null}
    </div>}
  </section>;
});
