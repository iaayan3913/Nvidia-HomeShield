import { Fragment, useId, useState } from 'react';
import { CalendarClock, ClipboardList, Crosshair, FileImage, HardHat, Home, Mic, ShieldAlert, Sparkles, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { StatusBadge } from '../../../shared/components/Status';
import type { Worker } from '../../../shared/types/domain';
import type { CaseRow, PlanVisit, TimelineEntry } from '../lib/derive';
import type { StockUnit } from '../lib/geo';
import { HAZARD_LABEL, JOB_STATUS_LABEL, SKILL_LABEL, formatRelative, formatTime, humanise, plural } from '../lib/format';

export type InspectorTarget =
  | { kind: 'case'; row: CaseRow; activity: TimelineEntry[]; siblings: string[] }
  | { kind: 'stock'; unit: StockUnit }
  | { kind: 'worker'; worker: Worker; active: PlanVisit[]; proposed: PlanVisit[] };

interface Props {
  target: InspectorTarget;
  now: number;
  busy: boolean;
  onClose(): void;
  onLocate(): void;
  onCreateProposal(caseId: string): void;
  onReviewProposal(planId: string): void;
  onSelectCase(caseId: string): void;
}

const LONG_SUMMARY = 160;

export function Inspector({ target, now, busy, onClose, onLocate, onCreateProposal, onReviewProposal, onSelectCase }: Props) {
  const headingId = useId();
  const title = target.kind === 'case' ? target.row.case.id : target.kind === 'stock' ? 'Synthetic stock unit' : target.worker.name;
  const eyebrow = target.kind === 'case' ? 'Case' : target.kind === 'stock' ? 'Housing stock' : 'Operative';
  return <section className="ops-inspector" aria-labelledby={headingId}>
    <header className="ops-panel-head">
      <div><span className="ops-eyebrow">{eyebrow}</span><h2 id={headingId} tabIndex={-1}>{title}</h2></div>
      <div className="ops-panel-head__actions">
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onLocate} aria-label="Centre map on this selection" title="Locate on map"><Crosshair size={17} aria-hidden="true" /></button>
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onClose} aria-label="Close inspector" title="Close"><X size={17} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="ops-inspector__body" key={target.kind === 'case' ? target.row.case.id : target.kind === 'stock' ? target.unit.id : target.worker.id}>
      {target.kind === 'case' ? <CaseDetails key={target.row.case.id} {...target} now={now} busy={busy} onCreateProposal={onCreateProposal} onReviewProposal={onReviewProposal} onSelectCase={onSelectCase} />
        : target.kind === 'stock' ? <StockDetails unit={target.unit} />
          : <WorkerDetails worker={target.worker} active={target.active} proposed={target.proposed} now={now} />}
    </div>
  </section>;
}

function CaseDetails({ row, activity, siblings, now, busy, onCreateProposal, onReviewProposal, onSelectCase }: Extract<InspectorTarget, { kind: 'case' }> & Pick<Props, 'now' | 'busy' | 'onCreateProposal' | 'onReviewProposal' | 'onSelectCase'>) {
  const [expanded, setExpanded] = useState(false);
  const summaryId = useId();
  const { case: item, property, job, worker, assignment, pendingPlan, pendingWorker, due } = row;
  const long = item.summary.length > LONG_SUMMARY;
  const evidenceKinds = item.evidence.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc; }, {});
  const canPropose = Boolean(job && job.status === 'unassigned' && !assignment && !pendingPlan && item.status !== 'resolved');
  const deadlines = ([['Make safe by', item.deadlines.make_safe_by], ['Investigate by', item.deadlines.investigate_by], ['Start works by', item.deadlines.start_works_by]] as const).filter(([, at]) => at);

  return <>
    <div className="ops-badges">
      <StatusBadge value={item.severity} /><StatusBadge value={item.status} />
      <span className="ops-tag">{HAZARD_LABEL[item.hazard_type]}{item.room ? ` · ${item.room}` : ''}</span>
    </div>
    {item.is_emergency ? <p className="ops-callout ops-callout--critical"><ShieldAlert size={17} aria-hidden="true" /><span><strong>Simulated emergency.</strong> In a real gas emergency call 0800 111 999, or 999 for immediate danger.</span></p> : null}

    <div className="ops-section">
      <p id={summaryId} className={`ops-summary${long && !expanded ? ' is-clamped' : ''}`}>{item.summary}</p>
      {long ? <button type="button" className="ops-text-button" aria-expanded={expanded} aria-controls={summaryId} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Read full description'}</button> : null}
      <p className="ops-note">Simulated classification for demonstration; not an official HHSRS determination.</p>
    </div>

    <div className="ops-section">
      <h3><Home size={16} aria-hidden="true" />Property</h3>
      {property ? <dl className="ops-dl">
        <dt>Address</dt><dd>{property.display_address}, {property.postcode} <span className="ops-muted">(fictional)</span></dd>
        <dt>Area</dt><dd>{property.area}, {property.district}</dd>
        <dt>Type</dt><dd>{humanise(property.archetype)}, {plural(property.floors, 'storey')}, {plural(property.bedrooms, 'bedroom')}</dd>
      </dl> : <p className="ops-muted">Property {item.property_id} is not in the shared demonstration stock.</p>}
      <p className="ops-note">Map position is a synthetic point; the column is schematic, not a building footprint.</p>
      {siblings.length ? <p className="ops-note">Other open cases here: {siblings.map((id, i) => <span key={id}>{i ? ', ' : ''}<button type="button" className="ops-text-button" onClick={() => onSelectCase(id)}>{id}</button></span>)}</p> : null}
    </div>

    <div className="ops-section">
      <h3><FileImage size={16} aria-hidden="true" />Evidence</h3>
      {item.evidence.length ? <ul className="ops-plain-list">
        {Object.entries(evidenceKinds).map(([kind, count]) => <li key={kind}>{kind === 'audio' ? <Mic size={14} aria-hidden="true" /> : <FileImage size={14} aria-hidden="true" />}{plural(count, kind === 'audio' ? 'voice note' : kind)}</li>)}
        {item.evidence.filter((e) => e.description).slice(0, 2).map((e, i) => <li key={i} className="ops-muted">{e.description}</li>)}
      </ul> : <p className="ops-muted">No photos or voice notes attached.</p>}
    </div>

    <div className="ops-section">
      <h3><CalendarClock size={16} aria-hidden="true" />Deadlines</h3>
      <p className="ops-due" data-tone={due.tone}>{due.label}{due.at ? <span className="ops-muted"> ({formatRelative(due.at, now)})</span> : null}</p>
      {deadlines.length > 1 ? <dl className="ops-dl">{deadlines.map(([label, at]) => <Fragment key={label}><dt>{label}</dt><dd>{formatTime(at, now)}</dd></Fragment>)}</dl> : null}
      <p className="ops-review" data-review={due.reviewRequired || undefined}>
        {due.reviewRequired ? 'Officer review required' : 'No review flag'} · {due.verified ? 'Verified' : 'Unverified, simulated'}
      </p>
      {item.deadlines.notes.map((note) => <p key={note} className="ops-note">{note}</p>)}
    </div>

    <div className="ops-section">
      <h3><HardHat size={16} aria-hidden="true" />Related job</h3>
      {job ? <dl className="ops-dl">
        <dt>Job</dt><dd>{job.id} · {SKILL_LABEL[job.required_skill]} · {job.duration_minutes} min</dd>
        <dt>Job status</dt><dd>{JOB_STATUS_LABEL[job.status]}</dd>
        <dt>Operative</dt><dd>{worker ? <>{worker.name}{assignment ? <> · visit {assignment.sequence + 1}, ETA {formatTime(assignment.eta, now)}</> : null}</> : 'No active assignment'}</dd>
        {pendingPlan ? <><dt>Pending</dt><dd>{pendingWorker?.name ?? 'Operative'} in proposal {pendingPlan.id} <span className="ops-muted">(not active until approved)</span></dd></> : null}
      </dl> : <p className="ops-muted">No job has been raised for this case.</p>}
      <div className="ops-actions">
        {canPropose ? <Button type="button" icon={<Sparkles size={17} aria-hidden="true" />} onClick={() => onCreateProposal(item.id)} disabled={busy}>Create schedule proposal</Button> : null}
        {pendingPlan ? <Button type="button" variant={item.is_emergency ? 'primary' : 'secondary'} icon={<ClipboardList size={17} aria-hidden="true" />} onClick={() => onReviewProposal(pendingPlan.id)}>Review pending proposal</Button> : null}
      </div>
      {canPropose ? <p className="ops-note">Runs the deterministic demonstration solver. Nothing changes until you approve the result.</p> : null}
    </div>

    <div className="ops-section">
      <h3>Case activity</h3>
      {activity.length ? <ol className="ops-mini-timeline">{activity.slice(0, 4).map((entry) => <li key={entry.id} data-tone={entry.tone}><strong>{entry.title}</strong><span>{entry.summary}</span><time dateTime={entry.at}>{formatTime(entry.at, now)} · {entry.source}</time></li>)}</ol> : <p className="ops-muted">No activity recorded.</p>}
    </div>
  </>;
}

function StockDetails({ unit }: { unit: StockUnit }) {
  return <>
    <p className="ops-callout"><span>Synthetic social-housing stock point used for spatial context. It is not a real address and has no resident data.</span></p>
    <dl className="ops-dl">
      <dt>Stock id</dt><dd>{unit.sourceId}</dd>
      <dt>Area</dt><dd>{unit.area}, {unit.district}</dd>
      <dt>Type</dt><dd>{humanise(unit.archetype)}</dd>
      <dt>Storeys</dt><dd>{unit.floors} (column height is schematic)</dd>
      {unit.bedrooms !== null ? <><dt>Bedrooms</dt><dd>{unit.bedrooms}</dd></> : null}
      {unit.builtYear !== null ? <><dt>Built</dt><dd>{unit.builtYear}</dd></> : null}
    </dl>
    <p className="ops-note">Stock ids come from the synthetic dataset and are unrelated to case property ids.</p>
  </>;
}

function WorkerDetails({ worker, active, proposed, now }: { worker: Worker; active: PlanVisit[]; proposed: PlanVisit[]; now: number }) {
  return <>
    <p className="ops-muted">{worker.role} · base {worker.home_district} · shift {formatTime(worker.shift_start, now)}–{formatTime(worker.shift_end, now)}</p>
    <div className="ops-badges">{worker.skills.map((skill) => <span key={skill} className="ops-tag">{SKILL_LABEL[skill]}</span>)}</div>
    <div className="ops-section"><h3>Approved visits</h3><VisitList visits={active} now={now} empty="No approved visits in the active plan." /></div>
    {proposed.length ? <div className="ops-section"><h3>Proposed visits (pending)</h3><VisitList visits={proposed} now={now} empty="" /></div> : null}
  </>;
}

export function VisitList({ visits, now, empty }: { visits: PlanVisit[]; now: number; empty: string }) {
  if (!visits.length) return <p className="ops-muted">{empty}</p>;
  return <ol className="ops-visits">{visits.map((visit) => <li key={visit.key}>
    <span className="ops-visits__seq" aria-label={`Visit ${visit.sequence}`}>{visit.sequence}</span>
    <span><strong>{visit.case?.id ?? visit.jobId}</strong>{visit.case ? ` · ${HAZARD_LABEL[visit.case.hazard_type]}` : ''}<br /><span className="ops-muted">{visit.property?.area ?? 'Unknown area'} · ETA {formatTime(visit.eta, now)}{visit.job ? ` · ${JOB_STATUS_LABEL[visit.job.status]}` : ''}</span></span>
  </li>)}</ol>;
}
