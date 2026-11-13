import { Fragment, useId, useState } from 'react';
import { CalendarClock, ClipboardList, Crosshair, FileImage, HardHat, Home, LoaderCircle, Mic, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { StatusBadge } from '../../../shared/components/Status';
import type { Worker } from '../../../shared/types/domain';
import type { CaseRow, PlanVisit, TimelineEntry } from '../lib/derive';
import { HAZARD_LABEL, JOB_STATUS_LABEL, SKILL_LABEL, formatRelative, formatTime, humanise, plural } from '../lib/format';
import type { CaseScene } from '../map/types';

export type InspectorTarget =
  | { kind: 'case'; row: CaseRow; activity: TimelineEntry[]; siblings: string[]; location: CaseScene['location'] | null }
  | { kind: 'worker'; worker: Worker; active: PlanVisit[]; proposed: PlanVisit[] };

interface Props {
  target: InspectorTarget;
  now: number;
  busy: boolean;
  simulatedServices: boolean;
  onLocate(): void;
  onCreateProposal(caseId: string): void;
  onReviewProposal(planId: string): void;
  onSelectCase(caseId: string): void;
}

const LONG_SUMMARY = 160;
const LOCATION_NOTE: Record<CaseScene['location'], string> = {
  inside: 'Shown on the building at the reported location.',
  nearest: 'Shown on the nearest building to the reported location (within 40 m).',
  approximate: 'Approximate location: no building footprint was found at the reported point.',
};

export function Inspector({ target, ...rest }: Props) {
  const title = target.kind === 'case' ? target.row.case.id : target.worker.name;
  return <div className="ops-inspector" key={title}>
    <div className="ops-inspector__title">
      <div><span className="ops-eyebrow">{target.kind === 'case' ? 'Case' : 'Operative'}</span><h3>{title}</h3></div>
      <button type="button" className="ops-icon-button ops-icon-button--small" onClick={rest.onLocate} aria-label="Centre map on this selection" title="Locate on map"><Crosshair size={17} aria-hidden="true" /></button>
    </div>
    {target.kind === 'case' ? <CaseDetails {...target} {...rest} /> : <WorkerDetails worker={target.worker} active={target.active} proposed={target.proposed} now={rest.now} />}
  </div>;
}

function CaseDetails({ row, activity, siblings, location, now, busy, simulatedServices, onCreateProposal, onReviewProposal, onSelectCase }: Extract<InspectorTarget, { kind: 'case' }> & Omit<Props, 'target' | 'onLocate'>) {
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
    {item.is_emergency ? <p className="ops-callout ops-callout--critical"><ShieldAlert size={17} aria-hidden="true" /><span><strong>{simulatedServices ? 'Test emergency.' : 'Emergency.'}</strong> For a gas emergency the resident should call 0800 111 999, or 999 if anyone is in immediate danger.</span></p> : null}

    <section className="ops-section" aria-label="Report">
      <p id={summaryId} className={`ops-summary${long && !expanded ? ' is-clamped' : ''}`}>{item.summary}</p>
      {long ? <button type="button" className="ops-text-button" aria-expanded={expanded} aria-controls={summaryId} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Read full description'}</button> : null}
      <p className="ops-note">Severity suggested by automated triage{simulatedServices ? ' (simulated in test mode)' : ''}. A housing officer confirms the priority; this is not an official HHSRS determination.</p>
    </section>

    <section className="ops-section" aria-label="Property">
      <h4><Home size={16} aria-hidden="true" />Property</h4>
      {property ? <dl className="ops-dl">
        <dt>Address</dt><dd>{property.display_address}, {property.postcode}</dd>
        <dt>Area</dt><dd>{property.area}, {property.district}</dd>
        <dt>Type</dt><dd>{humanise(property.archetype)}, {plural(property.floors, 'storey')}, {plural(property.bedrooms, 'bedroom')}</dd>
      </dl> : <p className="ops-muted">Property {item.property_id} is not in the property register.</p>}
      {location ? <p className="ops-note" data-location={location}>{LOCATION_NOTE[location]}</p> : null}
      {siblings.length ? <p className="ops-note">Other open cases here: {siblings.map((id, i) => <span key={id}>{i ? ', ' : ''}<button type="button" className="ops-text-button" onClick={() => onSelectCase(id)}>{id}</button></span>)}</p> : null}
    </section>

    <section className="ops-section" aria-label="Evidence">
      <h4><FileImage size={16} aria-hidden="true" />Evidence</h4>
      {item.evidence.length ? <ul className="ops-plain-list">
        {Object.entries(evidenceKinds).map(([kind, count]) => <li key={kind}>{kind === 'audio' ? <Mic size={14} aria-hidden="true" /> : <FileImage size={14} aria-hidden="true" />}{plural(count, kind === 'audio' ? 'voice note' : kind)}</li>)}
        {item.evidence.filter((e) => e.description).slice(0, 2).map((e, i) => <li key={i} className="ops-muted">{e.description}</li>)}
      </ul> : <p className="ops-muted">No photos or voice notes attached.</p>}
    </section>

    <section className="ops-section" aria-label="Deadlines">
      <h4><CalendarClock size={16} aria-hidden="true" />Deadlines</h4>
      <p className="ops-due" data-tone={due.tone}>{due.label}{due.at ? <span className="ops-muted"> ({formatRelative(due.at, now)})</span> : null}</p>
      {deadlines.length > 1 ? <dl className="ops-dl">{deadlines.map(([label, at]) => <Fragment key={label}><dt>{label}</dt><dd>{formatTime(at, now)}</dd></Fragment>)}</dl> : null}
      <p className="ops-review" data-review={due.reviewRequired || undefined}>{due.reviewRequired ? 'Officer review required' : 'No review flag'} · {due.verified ? 'Verified' : 'Not yet verified'}</p>
      {item.deadlines.notes.map((note) => <p key={note} className="ops-note">{note}</p>)}
    </section>

    <section className="ops-section" aria-label="Related job">
      <h4><HardHat size={16} aria-hidden="true" />Related job</h4>
      {job ? <dl className="ops-dl">
        <dt>Job</dt><dd>{job.id} · {SKILL_LABEL[job.required_skill]} · {job.duration_minutes} min</dd>
        <dt>Job status</dt><dd>{JOB_STATUS_LABEL[job.status]}</dd>
        <dt>Operative</dt><dd>{worker ? <>{worker.name}{assignment ? <> · visit {assignment.sequence + 1}, ETA {formatTime(assignment.eta, now)}</> : null}</> : 'No approved assignment'}</dd>
        {pendingPlan ? <><dt>Pending</dt><dd>{pendingWorker?.name ?? 'Operative'} in proposal {pendingPlan.id} <span className="ops-muted">(not active until approved)</span></dd></> : null}
      </dl> : <p className="ops-muted">No job has been raised for this case.</p>}
      <div className="ops-actions">
        {canPropose ? <Button type="button" icon={busy ? <LoaderCircle size={17} className="ops-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />} onClick={() => onCreateProposal(item.id)} disabled={busy} aria-busy={busy}>{busy ? 'Creating proposal…' : 'Create schedule proposal'}</Button> : null}
        {pendingPlan ? <Button type="button" variant={item.is_emergency ? 'primary' : 'secondary'} icon={<ClipboardList size={17} aria-hidden="true" />} onClick={() => onReviewProposal(pendingPlan.id)}>Review pending proposal</Button> : null}
      </div>
      {canPropose ? <p className="ops-note">The scheduler suggests visits. Nothing changes for operatives until you approve.</p> : null}
    </section>

    <section className="ops-section" aria-label="Case activity">
      <h4>Case activity</h4>
      <Timeline entries={activity.slice(0, 5)} now={now} compact />
    </section>
  </>;
}

function WorkerDetails({ worker, active, proposed, now }: { worker: Worker; active: PlanVisit[]; proposed: PlanVisit[]; now: number }) {
  return <>
    <p className="ops-muted">{worker.role} · base {worker.home_district} · shift {formatTime(worker.shift_start, now)}–{formatTime(worker.shift_end, now)}</p>
    <div className="ops-badges">{worker.skills.map((skill) => <span key={skill} className="ops-tag">{SKILL_LABEL[skill]}</span>)}</div>
    <section className="ops-section" aria-label="Approved visits"><h4>Approved visits</h4><VisitList visits={active} now={now} empty="No approved visits in the active plan." /></section>
    {proposed.length ? <section className="ops-section" aria-label="Proposed visits"><h4>Proposed visits (awaiting approval)</h4><VisitList visits={proposed} now={now} empty="" /></section> : null}
  </>;
}

export function VisitList({ visits, now, empty }: { visits: PlanVisit[]; now: number; empty: string }) {
  if (!visits.length) return <p className="ops-muted">{empty}</p>;
  return <ol className="ops-visits">{visits.map((visit) => <li key={visit.key}>
    <span className="ops-visits__seq" aria-label={`Visit ${visit.sequence}`}>{visit.sequence}</span>
    <span><strong>{visit.case?.id ?? visit.jobId}</strong>{visit.case ? ` · ${HAZARD_LABEL[visit.case.hazard_type]}` : ''}<br /><span className="ops-muted">{visit.property?.area ?? 'Unknown area'} · ETA {formatTime(visit.eta, now)}{visit.job ? ` · ${JOB_STATUS_LABEL[visit.job.status]}` : ''}</span></span>
  </li>)}</ol>;
}

export function Timeline({ entries, now, compact = false }: { entries: TimelineEntry[]; now: number; compact?: boolean }) {
  if (!entries.length) return <p className="ops-muted">No activity recorded.</p>;
  return <ol className={compact ? 'ops-mini-timeline' : 'ops-timeline'}>{entries.map((entry) => <li key={entry.id} data-tone={entry.tone}>
    {compact ? null : <time dateTime={entry.at}>{formatTime(entry.at, now)}</time>}
    <div>
      <strong>{entry.title}</strong>{!compact && entry.caseId ? <span className="ops-tag">{entry.caseId}</span> : null}
      <p>{entry.summary}</p>
      <small>{compact ? `${formatTime(entry.at, now)} · ` : ''}{entry.source}</small>
    </div>
  </li>)}</ol>;
}
