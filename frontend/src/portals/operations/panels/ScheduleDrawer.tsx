import { useId, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, ChevronDown, ChevronUp, CircleMinus, CirclePlus, History, ListChecks, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { StatusBadge } from '../../../shared/components/Status';
import type { SchedulePlan } from '../../../shared/types/domain';
import type { PlanComparison, PlanRoute, TimelineEntry } from '../lib/derive';
import { HAZARD_LABEL, formatTime, plural } from '../lib/format';
import { VisitList } from './Inspector';

export type DrawerTab = 'schedule' | 'activity';
export interface DecisionMessage { tone: 'success' | 'error' | 'info'; text: string; }

interface Props {
  tab: DrawerTab;
  onTabChange(tab: DrawerTab): void;
  expanded: boolean;
  onToggleExpanded(): void;
  onClose(): void;
  now: number;
  activePlan: SchedulePlan | null;
  activeRoutes: PlanRoute[];
  pending: SchedulePlan[];
  reviewPlan: SchedulePlan | null;
  reviewRoutes: PlanRoute[];
  comparison: PlanComparison | null;
  onReviewPlanChange(planId: string): void;
  onApprove(planId: string): void;
  onReject(planId: string, reason: string): void;
  busy: boolean;
  message: DecisionMessage | null;
  timeline: TimelineEntry[];
  timelineScope: 'all' | 'case';
  onTimelineScopeChange(scope: 'all' | 'case'): void;
  selectedCaseId: string | null;
}

export function ScheduleDrawer(props: Props) {
  const { tab, onTabChange, expanded, onToggleExpanded, onClose } = props;
  const tabsId = useId();
  const tabs: Array<[DrawerTab, string]> = [['schedule', 'Schedule'], ['activity', 'AI activity']];
  const onTabKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tab === 'schedule' ? 'activity' : 'schedule';
    onTabChange(next);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  };
  return <section className="ops-drawer" data-expanded={expanded || undefined} aria-label="Schedule and activity drawer">
    <header className="ops-drawer__head">
      <div role="tablist" aria-label="Drawer views" className="ops-tabs" onKeyDown={onTabKey}>
        {tabs.map(([value, label]) => <button key={value} id={`${tabsId}-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`${tabsId}-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => onTabChange(value)}>
          {value === 'schedule' ? <ListChecks size={16} aria-hidden="true" /> : <History size={16} aria-hidden="true" />}{label}
          {value === 'schedule' && props.pending.length ? <span className="ops-pill" aria-label={`${props.pending.length} pending`}>{props.pending.length}</span> : null}
        </button>)}
      </div>
      <div className="ops-panel-head__actions">
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onToggleExpanded} aria-label={expanded ? 'Shrink drawer' : 'Expand drawer'} title={expanded ? 'Shrink' : 'Expand'}>{expanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}</button>
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onClose} aria-label="Close drawer" title="Close"><X size={17} aria-hidden="true" /></button>
      </div>
    </header>
    <div id={`${tabsId}-${tab}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="ops-drawer__body" tabIndex={0}>
      {tab === 'schedule' ? <SchedulePanel {...props} /> : <ActivityPanel {...props} />}
    </div>
  </section>;
}

function SchedulePanel({ now, activePlan, activeRoutes, pending, reviewPlan, reviewRoutes, comparison, onReviewPlanChange, onApprove, onReject, busy, message }: Props) {
  const selectId = useId();
  return <div className="ops-schedule">
    <p className="ops-solver-note">Deterministic simulated scheduling output from the demonstration solver. It contains no AI reasoning, and routes link ordered stops schematically.</p>
    <div aria-live="polite" aria-atomic="true">{message ? <p className={`ops-message ops-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : undefined}>{message.tone === 'error' ? <TriangleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{message.text}</p> : null}</div>
    <div className="ops-compare">
      <section className="ops-compare__col" aria-label="Active plan">
        <h3><span className="ops-line ops-line--active" aria-hidden="true" />Active plan</h3>
        {activePlan ? <p className="ops-muted">{activePlan.id} · {activePlan.kind === 'replan' ? 're-plan' : 'schedule'} · approved · {activePlan.solver} {activePlan.solver_ms} ms</p> : <p className="ops-muted">No plan is active.</p>}
        <RouteList routes={activeRoutes} now={now} empty="No approved visits." />
      </section>
      <section className="ops-compare__col ops-compare__col--proposal" aria-label="Proposed plan">
        <h3><span className="ops-line ops-line--proposed" aria-hidden="true" />Proposal{pending.length > 1 ? ` (${pending.length} pending)` : ''}</h3>
        {reviewPlan && comparison ? <ProposalReview key={reviewPlan.id} plan={reviewPlan} routes={reviewRoutes} comparison={comparison} pending={pending} selectId={selectId} onReviewPlanChange={onReviewPlanChange} onApprove={onApprove} onReject={onReject} busy={busy} now={now} />
          : <p className="ops-muted">No proposal is awaiting approval. Select an unassigned case and choose “Create schedule proposal”.</p>}
      </section>
    </div>
  </div>;
}

function RouteList({ routes, now, empty }: { routes: PlanRoute[]; now: number; empty: string }) {
  if (!routes.length) return <p className="ops-muted">{empty}</p>;
  return <div className="ops-routes">{routes.map((route) => <div key={route.workerId} className="ops-route">
    <h4>{route.worker?.name ?? route.workerId}<span className="ops-muted"> · {plural(route.visits.length, 'visit')}</span></h4>
    <VisitList visits={route.visits} now={now} empty="No visits." />
  </div>)}</div>;
}

interface ReviewProps {
  plan: SchedulePlan; routes: PlanRoute[]; comparison: PlanComparison; pending: SchedulePlan[]; selectId: string; now: number; busy: boolean;
  onReviewPlanChange(planId: string): void; onApprove(planId: string): void; onReject(planId: string, reason: string): void;
}

function ProposalReview({ plan, routes, comparison, pending, selectId, now, busy, onReviewPlanChange, onApprove, onReject }: ReviewProps) {
  const [reviewed, setReviewed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reviewId = useId(); const reasonId = useId();
  const submitReject = (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 4) { setReasonError('Give a brief reason (at least 4 characters).'); return; }
    onReject(plan.id, reason.trim());
  };
  const icon = { added: CirclePlus, moved: ArrowRightLeft, dropped: CircleMinus } as const;
  return <div className="ops-proposal">
    <div className="ops-proposal__meta">
      {pending.length > 1 ? <label htmlFor={selectId} className="ops-inline-field">Reviewing
        <select id={selectId} value={plan.id} onChange={(e) => onReviewPlanChange(e.target.value)}>{pending.map((p) => <option key={p.id} value={p.id}>{p.id} ({p.kind === 'replan' ? 're-plan' : 'schedule'}, {formatTime(p.created_at, now)})</option>)}</select>
      </label> : <span>{plan.id}</span>}
      <StatusBadge value="pending" /><span className="ops-muted">{plan.kind === 'replan' ? 'Re-plan' : 'Schedule'} · {plan.solver} · {plan.solver_ms} ms · simulated</span>
    </div>
    <RouteList routes={routes} now={now} empty="The proposal contains no visits." />
    <div className="ops-proposal__changes">
      <h4>Changes</h4>
      {comparison.changes.length ? <ul className="ops-changes">{comparison.changes.map((change) => { const Icon = icon[change.change]; return <li key={change.key} data-change={change.change}>
        <Icon size={15} aria-hidden="true" /><span className="ops-change-tag">{change.change}</span>
        <span>{change.case?.id ?? change.jobId}{change.case ? ` (${HAZARD_LABEL[change.case.hazard_type]})` : ''}{change.from ? ` from ${change.from.name}` : ''}{change.to ? ` to ${change.to.name}` : ''}</span>
      </li>; })}</ul> : <p className="ops-muted">The solver reported no changes.</p>}
      {comparison.released.length ? <div className="ops-callout ops-callout--warning"><TriangleAlert size={16} aria-hidden="true" /><div>
        <strong>Not carried into this proposal</strong>
        <p>Approval activates this proposal as the whole plan, so these currently approved visits would no longer be active:</p>
        <ul>{comparison.released.map((v) => <li key={v.key}>{v.case?.id ?? v.jobId}{v.property ? ` · ${v.property.area}` : ''} (currently {v.worker?.name ?? v.workerId})</li>)}</ul>
      </div></div> : null}
      {comparison.unassigned.length ? <p className="ops-callout ops-callout--warning"><TriangleAlert size={16} aria-hidden="true" /><span>Unassigned: {comparison.unassigned.map((u) => u.case?.id ?? u.jobId).join(', ')}</span></p> : null}
      {comparison.conflicts.map((conflict) => <p key={conflict} className="ops-callout ops-callout--warning"><TriangleAlert size={16} aria-hidden="true" /><span>{conflict}</span></p>)}
    </div>
    {!rejecting ? <div className="ops-decision">
      <label className="ops-check" htmlFor={reviewId}><input id={reviewId} type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /><span><span>I have reviewed the proposed visits and changes</span><small>Required before approval</small></span></label>
      <div className="ops-actions">
        <Button type="button" onClick={() => onApprove(plan.id)} disabled={!reviewed || busy} icon={<CheckCircle2 size={17} aria-hidden="true" />}>Approve and activate</Button>
        <Button type="button" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>
      </div>
    </div> : <form className="ops-decision" onSubmit={submitReject} noValidate>
      <label htmlFor={reasonId}>Reason for rejection</label>
      <textarea id={reasonId} value={reason} rows={2} onChange={(e) => { setReason(e.target.value); setReasonError(null); }} aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-hint`} autoFocus />
      {reasonError ? <span id={`${reasonId}-error`} className="ops-field-error" role="alert">{reasonError}</span> : <span id={`${reasonId}-hint`} className="ops-muted">The active plan stays unchanged.</span>}
      <div className="ops-actions">
        <Button type="submit" variant="danger" disabled={busy}>Reject proposal</Button>
        <Button type="button" variant="quiet" onClick={() => { setRejecting(false); setReason(''); setReasonError(null); }}>Cancel</Button>
      </div>
    </form>}
  </div>;
}

function ActivityPanel({ timeline, timelineScope, onTimelineScopeChange, selectedCaseId, now }: Props) {
  return <div className="ops-activity">
    <div className="ops-activity__head">
      <p className="ops-solver-note">Human-readable summaries of simulated actions from the shared activity log, case records and approval records. These are not model reasoning.</p>
      <div className="ops-segmented" role="radiogroup" aria-label="Activity scope">
        <button type="button" role="radio" aria-checked={timelineScope === 'all'} onClick={() => onTimelineScopeChange('all')}>All</button>
        <button type="button" role="radio" aria-checked={timelineScope === 'case'} disabled={!selectedCaseId} onClick={() => onTimelineScopeChange('case')}>{selectedCaseId ?? 'Selected case'}</button>
      </div>
    </div>
    {timeline.length ? <ol className="ops-timeline">{timeline.map((entry) => <li key={entry.id} data-tone={entry.tone}>
      <time dateTime={entry.at}>{formatTime(entry.at, now)}</time>
      <div><strong>{entry.title}</strong>{entry.caseId ? <span className="ops-tag">{entry.caseId}</span> : null}<p>{entry.summary}</p><small>{entry.source} · simulated</small></div>
    </li>)}</ol> : <p className="ops-muted">No activity yet.</p>}
  </div>;
}
