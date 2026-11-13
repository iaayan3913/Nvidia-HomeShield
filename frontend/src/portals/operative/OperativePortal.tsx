import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ChevronDown, Inbox, Route, Wifi, WifiOff, X } from 'lucide-react';
import { Select } from '../../shared/components/FormControls';
import { homeShieldService, isApiMode, useConnectionState, useDemoState } from '../../shared/data';
import type { DemoState } from '../../shared/types/domain';
import { JobCard, JobStatusTag, PriorityTag } from './JobCard';
import { RoutePreview } from './RoutePreview';
import { formatTime, humanise, isFinished, pendingProposalCount, workItemsFor } from './model';
import './operative.css';

const subscribeOnline = (notify: () => void) => { window.addEventListener('online', notify); window.addEventListener('offline', notify); return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify); }; };
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

type RouteChange = { planKind: string; added: string[]; removed: string[]; approvedAt?: string };
const caseRef = (state: DemoState, jobId: string) => state.jobs.find((j) => j.id === jobId)?.case_id ?? jobId;

export function OperativePortal() {
  const state = useDemoState();
  const connection = useConnectionState();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const requested = params.get('worker');
  const fallbackId = state.workers.find((w) => workItemsFor(state, w.id).length)?.id ?? state.workers[0]?.id;
  const worker = state.workers.find((w) => w.id === (requested ?? fallbackId));
  const items = worker ? workItemsFor(state, worker.id) : [];
  const open = items.filter((i) => !isFinished(i.job.status));
  const done = items.filter((i) => isFinished(i.job.status));
  const [next, ...later] = open;
  const pending = worker ? pendingProposalCount(state, worker.id) : 0;
  const plan = state.active_plan;
  const replanTouchesWorker = Boolean(worker && plan?.kind === 'replan' && plan.changes.some((c) => c.to_worker_id === worker.id || c.from_worker_id === worker.id));

  // Pin the default worker into the URL so identity never shifts on its own as assignments change.
  useEffect(() => { if (!requested && fallbackId) setParams({ worker: fallbackId }, { replace: true }); }, [requested, fallbackId, setParams]);

  // Detect a live route change when an approved plan replaces the one this worker was viewing.
  const [change, setChange] = useState<RouteChange | null>(null);
  const seen = useRef<{ worker?: string; plan?: string; jobs: string[] }>({ jobs: [] });
  const planId = state.active_plan?.id; const jobKey = items.map((i) => i.job.id).join();
  useEffect(() => {
    const previous = seen.current; const jobs = jobKey ? jobKey.split(',') : [];
    seen.current = { worker: worker?.id, plan: planId, jobs };
    if (previous.worker !== worker?.id) { setChange(null); return; }
    if (previous.plan === planId) return;
    const latest = homeShieldService.getState();
    const approval = latest.approvals.find((a) => a.plan_id === planId && a.status === 'approved');
    if (!approval) return; // e.g. a demo reset restores the base plan without an officer decision
    const added = jobs.filter((id) => !previous.jobs.includes(id)).map((id) => caseRef(latest, id));
    const removed = previous.jobs.filter((id) => !jobs.includes(id)).map((id) => caseRef(latest, id));
    if (!added.length && !removed.length) return;
    const planKind = latest.active_plan?.kind === 'replan' ? 'An emergency re-plan' : 'A new schedule';
    setChange({ planKind, added, removed, approvedAt: approval.decided_at ?? undefined });
  }, [worker?.id, planId, jobKey]);

  if (!state.workers.length) return <div className="op"><Empty icon={Inbox} title="No demonstration operatives">The shared demonstration data has no operatives. Reset the demo from Operations to restore them.</Empty></div>;

  return <div className="op">
    <section className="op-identity" aria-labelledby="op-title">
      <div className="op-identity__top">
        <div>
          <span className="eyebrow">Operative · {isApiMode ? 'FastAPI assignments' : 'demonstration user'}</span>
          <h1 id="op-title">{worker ? worker.name : 'Choose an operative'}</h1>
        </div>
        <span className="op-connection" data-online={online} role="status">
          {online ? <Wifi size={16} aria-hidden="true" /> : <WifiOff size={16} aria-hidden="true" />}
          {isApiMode ? (connection.status === 'connected' ? 'Live backend updates' : 'Backend unavailable') : (online ? 'Live demo updates' : 'Offline · changes save on this device')}
        </span>
      </div>
      <Select label="Viewing as (demonstration user)" value={worker?.id ?? ''} onChange={(e) => { setParams({ worker: e.target.value }, { replace: true }); }}>
        {!worker && <option value="" disabled>Choose an operative</option>}
        {state.workers.map((w) => { const count = workItemsFor(state, w.id).filter((i) => !isFinished(i.job.status)).length; return <option key={w.id} value={w.id}>{w.name} — {count} active job{count === 1 ? '' : 's'}</option>; })}
      </Select>
      {requested && !state.workers.some((w) => w.id === requested) && <p className="op-error" role="alert">Demonstration user “{requested}” was not found. Choose an operative above.</p>}
      {worker && <dl className="op-identity__meta">
        <div><dt>Role</dt><dd>{worker.role}</dd></div>
        <div><dt>Shift</dt><dd>{formatTime(worker.shift_start)}–{formatTime(worker.shift_end)} · base {worker.home_district}</dd></div>
        <div className="op-identity__skills"><dt>Skills</dt><dd><ul aria-label="Skills">{worker.skills.map((s) => <li key={s}>{humanise(s)}</li>)}</ul></dd></div>
      </dl>}
    </section>
    {isApiMode ? <p className="op-replan-note" role="note">Assignments come from the approved FastAPI plan. Job progress controls are local demonstration-only because the backend has no operative progress endpoint yet.</p> : null}

    {change && <div className="op-change" role="alert">
      <Route size={20} aria-hidden="true" />
      <div>
        <strong>Your route has changed</strong>
        <p>{change.planKind} was approved by Operations at {formatTime(change.approvedAt)}.
          {change.added.length > 0 && <> Added: {change.added.join(', ')}.</>}
          {change.removed.length > 0 && <> No longer assigned to you: {change.removed.join(', ')}.</>}</p>
      </div>
      <button type="button" className="op-icon-button" onClick={() => setChange(null)} aria-label="Dismiss route change"><X size={18} aria-hidden="true" /></button>
    </div>}

    {!change && replanTouchesWorker && <p className="op-replan-note" role="note"><Route size={18} aria-hidden="true" />Your route was updated by an emergency re-plan approved by Operations{plan ? ` at ${formatTime(state.approvals.find((a) => a.plan_id === plan.id)?.decided_at)}` : ''}.</p>}

    {worker && <div className="op-grid">
      <section className="op-next" aria-labelledby="op-next-heading">
        <h2 id="op-next-heading" tabIndex={-1}>Next job</h2>
        {next ? <JobCard item={next} route={<RoutePreview start={worker} startLabel={`Shift base (${worker.home_district})`}
          stops={open.map((i) => ({ id: i.job.id, lat: i.job.lat, lon: i.job.lon, label: i.case?.id ?? i.job.id, current: i === next }))} />} />
          : items.length ? <Empty icon={CheckCircle2} title="All assigned jobs finished" tone="success">Nice work. Operations has your updates. New work will appear here once an officer approves it.</Empty>
          : <Empty icon={Inbox} title="No active assignments">Jobs appear here only after a housing officer approves a schedule. {pending > 0 ? `${pending} proposed schedule${pending === 1 ? ' mentions' : 's mention'} you but ${pending === 1 ? 'is' : 'are'} awaiting approval, so ${pending === 1 ? 'it is' : 'they are'} not your work yet.` : 'Nothing is waiting for approval for you either.'}</Empty>}
      </section>

      <aside className="op-side" aria-label="Rest of today">
        {next && <section aria-labelledby="op-later-heading">
          <h2 id="op-later-heading">Later today <span className="op-count">{later.length}</span></h2>
          {later.length ? <ol className="op-list">{later.map((item) => <li key={item.job.id}>
            <details className="op-later">
              <summary>
                <span className="op-later__time"><CalendarClock size={16} aria-hidden="true" />{formatTime(item.eta)}</span>
                <span className="op-later__main"><strong>{item.case?.id ?? item.job.case_id} · {item.property?.display_address ?? 'Address unavailable'}</strong><span>{item.case?.summary}</span><span className="op-job__tags"><PriorityTag item={item} /><JobStatusTag status={item.job.status} /></span></span>
                <ChevronDown className="op-later__chevron" size={20} aria-hidden="true" />
              </summary>
              <JobCard item={item} />
            </details>
          </li>)}</ol> : <p className="op-muted">No further jobs after this one.</p>}
        </section>}
        {done.length > 0 && <section aria-labelledby="op-done-heading">
          <h2 id="op-done-heading">Finished <span className="op-count">{done.length}</span></h2>
          <ol className="op-list op-list--done">{done.map((item) => <li key={item.job.id}>
            <strong>{item.case?.id ?? item.job.case_id}</strong> <JobStatusTag status={item.job.status} />
            <span>{item.property?.display_address}{item.job.completion_notes ? ` — ${item.job.completion_notes}` : ''}</span>
          </li>)}</ol>
        </section>}
        <p className="op-muted op-demo-note">All people, addresses and jobs are fictional demonstration data. Only schedules approved by a housing officer appear here.</p>
      </aside>
    </div>}
  </div>;
}

function Empty({ icon: Icon, title, tone, children }: { icon: typeof Inbox; title: string; tone?: 'success'; children: React.ReactNode }) {
  return <div className="op-empty" data-tone={tone}><Icon size={28} aria-hidden="true" /><h3>{title}</h3><p>{children}</p></div>;
}
