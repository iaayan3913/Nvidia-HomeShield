import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CloudOff, Inbox, Loader2, Route, X } from 'lucide-react';
import { Select } from '../../shared/components/FormControls';
import { mockService, useConnection, useDemoState } from '../../shared/mock';
import type { DemoState } from '../../shared/types/domain';
import { JobCard, JobStatusTag, PriorityTag } from './JobCard';
import { RoutePreview } from './RoutePreview';
import { formatTime, humanise, isFinished, sentence, pendingProposalCount, referenceOf, titleOf, workItemsFor } from './model';
import './operative.css';

type RouteChange = { planKind: string; added: string[]; removed: string[]; approvedAt?: string };
const caseRef = (state: DemoState, jobId: string) => state.jobs.find((j) => j.id === jobId)?.case_id ?? jobId;

export function OperativePortal() {
  const state = useDemoState();
  const connection = useConnection();
  const [params, setParams] = useSearchParams();
  const requested = params.get('worker');
  const fallbackId = state.workers.find((w) => workItemsFor(state, w.id).length)?.id ?? state.workers[0]?.id;
  const worker = state.workers.find((w) => w.id === (requested ?? fallbackId));
  const items = worker ? workItemsFor(state, worker.id) : [];
  const open = items.filter((i) => !isFinished(i.job.status));
  const done = items.filter((i) => isFinished(i.job.status));
  const next = open[0];
  const pending = worker ? pendingProposalCount(state, worker.id) : 0;
  const plan = state.active_plan;
  const replanTouchesWorker = Boolean(worker && plan?.kind === 'replan' && plan.changes.some((c) => c.to_worker_id === worker.id || c.from_worker_id === worker.id));

  // The selected job defaults to the next one, and falls back to it if a route change removes the selection.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((i) => i.job.id === selectedId) ?? next ?? done[0];

  // Pin the default worker into the URL so identity never shifts on its own as assignments change.
  useEffect(() => { if (!requested && fallbackId) setParams({ worker: fallbackId }, { replace: true }); }, [requested, fallbackId, setParams]);

  // Detect a live route change when an approved plan replaces the one this worker was viewing.
  const [change, setChange] = useState<RouteChange | null>(null);
  const seen = useRef<{ worker?: string; plan?: string; jobs: string[] }>({ jobs: [] });
  const planId = plan?.id; const jobKey = items.map((i) => i.job.id).join();
  useEffect(() => {
    const previous = seen.current; const jobs = jobKey ? jobKey.split(',') : [];
    seen.current = { worker: worker?.id, plan: planId, jobs };
    if (previous.worker !== worker?.id) { setChange(null); return; }
    if (previous.plan === planId) return;
    const latest = mockService.getState();
    const approval = latest.approvals.find((a) => a.plan_id === planId && a.status === 'approved');
    if (!approval) return; // e.g. a reset restores a plan without an officer decision
    const added = jobs.filter((id) => !previous.jobs.includes(id)).map((id) => caseRef(latest, id));
    const removed = previous.jobs.filter((id) => !jobs.includes(id)).map((id) => caseRef(latest, id));
    if (!added.length && !removed.length) return;
    setChange({ planKind: latest.active_plan?.kind === 'replan' ? 'An emergency re-plan' : 'A new schedule', added, removed, approvedAt: approval.decided_at ?? undefined });
  }, [worker?.id, planId, jobKey]);

  if (!state.workers.length) {
    const loading = connection.mode === 'api' && connection.status !== 'offline';
    return <div className="op"><Empty icon={loading ? Loader2 : CloudOff} title={loading ? 'Loading today’s work…' : 'Cannot load operatives'}>
      {loading ? 'Connecting to HomeShield.' : 'HomeShield could not be reached. It will keep retrying automatically; check that the backend is running.'}</Empty></div>;
  }

  return <div className="op">
    <section className="op-identity" aria-labelledby="op-title">
      <div className="op-identity__who">
        <h1 id="op-title">{worker ? worker.name : 'Choose an operative'}</h1>
        {worker && <p className="op-identity__meta">{worker.role} · Shift {formatTime(worker.shift_start)}–{formatTime(worker.shift_end)}{worker.home_district ? ` · Base ${worker.home_district}` : ''}</p>}
        {worker && <ul className="op-skills" aria-label="Skills">{worker.skills.map((s) => <li key={s}>{sentence(humanise(s))}</li>)}</ul>}
      </div>
      <div className="op-identity__select">
        <Select label="Viewing as" hint="No sign-in yet: choose whose work to show." value={worker?.id ?? ''} onChange={(e) => { setSelectedId(null); setParams({ worker: e.target.value }, { replace: true }); }}>
          {!worker && <option value="" disabled>Choose an operative</option>}
          {state.workers.map((w) => { const count = workItemsFor(state, w.id).filter((i) => !isFinished(i.job.status)).length; return <option key={w.id} value={w.id}>{w.name} ({count} open job{count === 1 ? '' : 's'})</option>; })}
        </Select>
      </div>
      {requested && !state.workers.some((w) => w.id === requested) && <p className="op-error" role="alert">Operative “{requested}” was not found. Choose someone above.</p>}
    </section>

    {connection.mode === 'api' && connection.status === 'offline' && <p className="op-offline" role="status"><CloudOff size={18} aria-hidden="true" />Connection lost. Showing the last information received{connection.lastEventAt ? ` (updated ${formatTime(connection.lastEventAt)})` : ''}. Updates will not save until HomeShield reconnects; it is retrying automatically.</p>}

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
      <nav className="op-route-list" aria-labelledby="op-list-heading">
        <h2 id="op-list-heading">Today’s route <span className="op-count">{open.length} open</span></h2>
        {items.length ? <ol className="op-list">{items.map((item) => {
          const isNext = item === next; const current = item === selected;
          return <li key={item.job.id}>
            <button type="button" className="op-list__item" aria-current={current ? 'true' : undefined} data-finished={isFinished(item.job.status) || undefined} onClick={() => setSelectedId(item.job.id)}>
              <span className="op-list__time">{formatTime(item.eta)}{isNext && <span className="op-next-flag">Next</span>}</span>
              <span className="op-list__main">
                <strong>{titleOf(item)}</strong>
                <span>{referenceOf(item)} · {item.property?.display_address ?? 'Address not available'}</span>
                <span className="op-job__tags"><PriorityTag item={item} /><JobStatusTag status={item.job.status} /></span>
              </span>
            </button>
          </li>;
        })}</ol> : <Empty icon={Inbox} title="No active assignments">Jobs appear here once a housing officer approves a schedule. {pending > 0 ? `${pending} proposed schedule${pending === 1 ? ' includes' : 's include'} you but ${pending === 1 ? 'is' : 'are'} awaiting approval, so ${pending === 1 ? 'it is' : 'they are'} not your work yet.` : 'Nothing is waiting for approval for you either.'}</Empty>}
        {items.length > 0 && !open.length && <p className="op-all-done"><CheckCircle2 size={18} aria-hidden="true" />All assigned jobs are finished. New work appears here when an officer approves it.</p>}
      </nav>

      <section className="op-detail" aria-labelledby="op-detail-heading">
        <h2 id="op-detail-heading" className="visually-hidden" tabIndex={-1}>{selected ? (selected === next ? 'Next job' : 'Selected job') : 'Job details'}</h2>
        {selected ? <JobCard item={selected} route={open.length > 0 && <RoutePreview start={worker} startLabel={`Shift base${worker.home_district ? ` (${worker.home_district})` : ''}`}
          stops={open.map((i) => ({ id: i.job.id, lat: i.job.lat, lon: i.job.lon, label: referenceOf(i), current: i === selected }))} />} />
          : <Empty icon={Inbox} title="Nothing to show">Choose a job from today’s route.</Empty>}
      </section>
    </div>}
    {state.properties.some((p) => p.synthetic) && <p className="op-attribution">Addresses come from a sample property register, not real homes.</p>}
  </div>;
}

function Empty({ icon: Icon, title, children }: { icon: typeof Inbox; title: string; children: React.ReactNode }) {
  return <div className="op-empty"><Icon size={28} aria-hidden="true" className={Icon === Loader2 ? 'op-spin' : undefined} /><h3>{title}</h3><p>{children}</p></div>;
}
