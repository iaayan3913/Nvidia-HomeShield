import { useId, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, ChevronDown, ChevronUp, CircleMinus, CirclePlus, ListChecks, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { StatusBadge } from '../../../shared/components/Status';
import type { SchedulePlan } from '../../../shared/types/domain';
import type { PlanComparison, PlanRoute } from '../lib/derive';
import { HAZARD_LABEL, formatTime, plural } from '../lib/format';
import { VisitList } from './Inspector';

export interface DecisionMessage { tone: 'success' | 'error' | 'info'; text: string; retry?: () => void; }

interface Props {
  expanded: boolean;
  onToggleExpanded(): void;
  onClose(): void;
  now: number;
  simulatedServices: boolean;
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
}

const solverText = (plan: SchedulePlan, simulated: boolean) => `${simulated ? 'Simulated solver' : 'Solver'}: ${plan.solver} · ${plan.solver_ms} ms`;

export function ScheduleDrawer(props: Props) {
  const { expanded, onToggleExpanded, onClose, now, simulatedServices, activePlan, activeRoutes, pending, reviewPlan, reviewRoutes, comparison, onReviewPlanChange, onApprove, onReject, busy, message } = props;
  const headingId = useId(); const selectId = useId();
  return <section className="ops-drawer" data-expanded={expanded || undefined} aria-labelledby={headingId}>
    <header className="ops-drawer__head">
      <h2 id={headingId}><ListChecks size={17} aria-hidden="true" />Schedule{pending.length ? <span className="ops-pill" aria-label={`${pending.length} awaiting approval`}>{pending.length}</span> : null}</h2>
      <div className="ops-panel-head__actions">
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onToggleExpanded} aria-label={expanded ? 'Shrink schedule' : 'Expand schedule'} title={expanded ? 'Shrink' : 'Expand'}>{expanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}</button>
        <button type="button" className="ops-icon-button ops-icon-button--small" onClick={onClose} aria-label="Close schedule" title="Close"><X size={17} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="ops-drawer__body" tabIndex={0} aria-label="Schedule comparison">
      <p className="ops-solver-note">{simulatedServices ? 'Test mode: schedules come from a simulated solver. ' : ''}Routes join each operative’s ordered stops; they are not turn-by-turn directions. No AI reasoning is shown.</p>
      <div aria-live="polite" aria-atomic="true">{message ? <p className={`ops-message ops-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : undefined}>
        {message.tone === 'error' ? <TriangleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}<span>{message.text}</span>
        {message.retry ? <button type="button" className="ops-text-button" onClick={message.retry}>Try again</button> : null}
      </p> : null}</div>
      <div className="ops-compare">
        <section className="ops-compare__col" aria-label="Active plan">
          <h3><span className="ops-line ops-line--active" aria-hidden="true" />Active plan</h3>
          {activePlan ? <p className="ops-muted">{activePlan.id} · {activePlan.kind === 'replan' ? 're-plan' : 'schedule'} · approved · {solverText(activePlan, simulatedServices)}</p> : <p className="ops-muted">No plan is active.</p>}
          <RouteList routes={activeRoutes} now={now} empty="No approved visits." />
        </section>
        <section className="ops-compare__col ops-compare__col--proposal" aria-label="Proposed plan">
          <h3><span className="ops-line ops-line--proposed" aria-hidden="true" />Proposal{pending.length > 1 ? ` (${pending.length} pending)` : ''}</h3>
          {reviewPlan && comparison ? <ProposalReview key={reviewPlan.id} plan={reviewPlan} routes={reviewRoutes} comparison={comparison} pending={pending} selectId={selectId} onReviewPlanChange={onReviewPlanChange} onApprove={onApprove} onReject={onReject} busy={busy} now={now} simulated={simulatedServices} />
            : <p className="ops-muted">No proposal is awaiting approval. Select a case without an approved visit and choose “Create schedule proposal”.</p>}
        </section>
      </div>
    </div>
  </section>;
}

function RouteList({ routes, now, empty }: { routes: PlanRoute[]; now: number; empty: string }) {
  if (!routes.length) return <p className="ops-muted">{empty}</p>;
  return <div className="ops-routes">{routes.map((route) => <div key={route.workerId} className="ops-route">
    <h4>{route.worker?.name ?? route.workerId}<span className="ops-muted"> · {plural(route.visits.length, 'visit')}</span></h4>
    <VisitList visits={route.visits} now={now} empty="No visits." />
  </div>)}</div>;
}

interface ReviewProps {
  plan: SchedulePlan; routes: PlanRoute[]; comparison: PlanComparison; pending: SchedulePlan[]; selectId: string; now: number; busy: boolean; simulated: boolean;
  onReviewPlanChange(planId: string): void; onApprove(planId: string): void; onReject(planId: string, reason: string): void;
}

function ProposalReview({ plan, routes, comparison, pending, selectId, now, busy, simulated, onReviewPlanChange, onApprove, onReject }: ReviewProps) {
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
      <StatusBadge value="pending" /><span className="ops-muted">{plan.kind === 'replan' ? 'Re-plan' : 'Schedule'} · {solverText(plan, simulated)}</span>
    </div>
    <RouteList routes={routes} now={now} empty="The proposal contains no visits." />
    <div className="ops-proposal__changes">
      <h4>Changes</h4>
      {comparison.changes.length ? <ul className="ops-changes">{comparison.changes.map((change) => { const Icon = icon[change.change]; return <li key={change.key} data-change={change.change}>
        <Icon size={15} aria-hidden="true" /><span className="ops-change-tag">{change.change}</span>
        <span>{change.case?.id ?? change.jobId}{change.case ? ` (${HAZARD_LABEL[change.case.hazard_type]})` : ''}{change.from ? ` from ${change.from.name}` : ''}{change.to ? ` to ${change.to.name}` : ''}</span>
      </li>; })}</ul> : <p className="ops-muted">The scheduler reported no changes.</p>}
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
        <Button type="button" onClick={() => onApprove(plan.id)} disabled={!reviewed || busy} aria-busy={busy} icon={busy ? <LoaderCircle size={17} className="ops-spin" aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}>{busy ? 'Approving…' : 'Approve and activate'}</Button>
        <Button type="button" variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>
      </div>
    </div> : <form className="ops-decision" onSubmit={submitReject} noValidate>
      <label htmlFor={reasonId}>Reason for rejection</label>
      <textarea id={reasonId} value={reason} rows={2} onChange={(e) => { setReason(e.target.value); setReasonError(null); }} aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-hint`} autoFocus />
      {reasonError ? <span id={`${reasonId}-error`} className="ops-field-error" role="alert">{reasonError}</span> : <span id={`${reasonId}-hint`} className="ops-muted">The active plan stays unchanged.</span>}
      <div className="ops-actions">
        <Button type="submit" variant="danger" disabled={busy}>{busy ? 'Rejecting…' : 'Reject proposal'}</Button>
        <Button type="button" variant="quiet" onClick={() => { setRejecting(false); setReason(''); setReasonError(null); }}>Cancel</Button>
      </div>
    </form>}
  </div>;
}
