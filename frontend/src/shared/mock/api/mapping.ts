/**
 * The single place where FastAPI schemas become frontend domain types.
 * Field differences are documented beside each mapper (and in the platform handoff).
 */
import type { AgentActivity, Approval, AppNotification, Assignment, Case, DemoState, Job, Property, RouteChange, SchedulePlan, Skill, Worker } from '../../types/domain';

export interface BackendCase extends Omit<Case, 'property_id' | 'simulated' | 'report_id'> { property_id: string | null; }
export interface BackendWorker { id: string; name: string; skills: Skill[]; shift_start: string; shift_end: string; lat: number; lon: number; }
export interface BackendJob extends Omit<Job, 'property_id' | 'completion_notes' | 'evidence_count' | 'updated_at'> {
  property_id: string | null; completion_notes: string | null; evidence_count: number | null; updated_at: string | null;
}
export interface BackendPlan { id: string; solver: string; solver_ms: number; workers: SchedulePlan['workers']; unassigned_jobs: string[]; conflicts: string[]; created_at: string; approved: boolean; }
export interface BackendApproval { id: string; case_id: string; action: string; payload: Record<string, unknown>; status: Approval['status']; requested_at: string; decided_at: string | null; decided_by: string | null; outcome: string | null; }
export interface BackendEvent { sequence: number; id: string; case_id: string | null; type: string; summary: string; tool_name: string | null; payload: Record<string, unknown>; success: boolean | null; created_at: string; }
export interface Health { status: string; mocks: boolean; dev_reset?: boolean; }
export interface Snapshot { cases: BackendCase[]; workers: BackendWorker[]; plans: BackendPlan[]; approvals: BackendApproval[]; events: BackendEvent[]; jobs: BackendJob[]; properties: Property[]; }

/** Backend timestamps may be naive (no zone); they are UTC. */
export const utc = (value: string | null | undefined): string | null => value == null ? null : /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;

// Case: backend `property_id` may be null; there is no `report_id`/`simulated`.
export const mapCase = (item: BackendCase, simulated: boolean): Case => ({ ...item, property_id: item.property_id ?? '', created_at: utc(item.created_at)!, updated_at: utc(item.updated_at)!, simulated });

// Worker: backend has no `role` or `home_district`; derive them from skills and the nearest register property.
const SKILL_LABEL: Record<string, string> = { general: 'General repairs', damp_mould: 'Damp and mould', plumbing: 'Plumbing', electrical: 'Electrical', gas: 'Gas', fire: 'Fire safety' };
export function mapWorker(item: BackendWorker, properties: Property[]): Worker {
  const nearest = properties.reduce<Property | null>((best, p) => !best || (p.lat - item.lat) ** 2 + (p.lon - item.lon) ** 2 < (best.lat - item.lat) ** 2 + (best.lon - item.lon) ** 2 ? p : best, null);
  const specialisms = item.skills.filter((s) => s !== 'general').map((s) => SKILL_LABEL[s] ?? s);
  const role = specialisms.length === 1 ? `${specialisms[0]} operative` : specialisms.length ? 'Multi-skilled operative' : 'Repairs operative';
  return { ...item, shift_start: utc(item.shift_start)!, shift_end: utc(item.shift_end)!, role, home_district: nearest?.district ?? '' };
}

// Job: adds `source`, `hazard_type`, `severity`, `access_notes`; nullable notes/count/updated_at become optional.
export const mapJob = (item: BackendJob): Job => ({
  ...item, property_id: item.property_id ?? '', earliest: utc(item.earliest), latest: utc(item.latest),
  completion_notes: item.completion_notes ?? undefined, evidence_count: item.evidence_count ?? undefined, updated_at: utc(item.updated_at) ?? '',
});

// Plan: backend has no `kind`, `changes` or `simulated`; they come from plan events and the linked case.
export function mapPlan(item: BackendPlan, kind: SchedulePlan['kind'], changes: RouteChange[], simulated: boolean): SchedulePlan {
  return { ...item, created_at: utc(item.created_at)!, workers: item.workers.map((w) => ({ ...w, stops: w.stops.map((s) => ({ ...s, eta: utc(s.eta)! })) })), kind, changes, simulated };
}

/** `diff_plans` payload ({moved, added, dropped}) → RouteChange[]. */
export function mapChanges(payload: unknown): RouteChange[] {
  const diff = (payload ?? {}) as { moved?: Array<{ job_id: string; from: string; to: string }>; added?: Array<{ job_id: string; to: string }>; dropped?: Array<{ job_id: string; from: string }> };
  return [
    ...(diff.added ?? []).map((c) => ({ job_id: c.job_id, to_worker_id: c.to, change: 'added' as const })),
    ...(diff.moved ?? []).map((c) => ({ job_id: c.job_id, from_worker_id: c.from, to_worker_id: c.to, change: 'moved' as const })),
    ...(diff.dropped ?? []).map((c) => ({ job_id: c.job_id, from_worker_id: c.from, change: 'dropped' as const })),
  ];
}

// Approval: backend `payload.plan_id` → `plan_id`; `commit_plan` → `activate_schedule`/`activate_replan`; `outcome` → `reason`.
export function mapApproval(item: BackendApproval, emergencyCases: Set<string>): Approval {
  const action = item.action === 'commit_plan' || item.action === 'schedule_job' ? (emergencyCases.has(item.case_id) ? 'activate_replan' : 'activate_schedule') : item.action;
  return { id: item.id, case_id: item.case_id, plan_id: typeof item.payload.plan_id === 'string' ? item.payload.plan_id : '', action, status: item.status, requested_at: utc(item.requested_at)!, decided_at: utc(item.decided_at), decided_by: item.decided_by, reason: item.outcome };
}

// Event: identical apart from `simulated` and the retained `sequence`.
export const mapEvent = (item: BackendEvent, simulated: boolean): AgentActivity => ({ ...item, created_at: utc(item.created_at)!, simulated });

const NOTICE: Record<string, [AppNotification['kind'], string]> = {
  'case.created': ['info', 'New report received'], 'emergency.created': ['critical', 'Possible emergency'],
  'plan.activated': ['success', 'Schedule activated'], 'plan.failed': ['warning', 'Scheduling failed'], 'job.progress': ['info', 'Job progress'],
};
export const eventNotice = (event: BackendEvent): AppNotification | null => {
  const notice = NOTICE[event.type];
  return notice ? { id: `notice-${event.id}`, kind: notice[0], title: notice[1], message: event.case_id ? `${event.summary} (${event.case_id}).` : `${event.summary}.`, created_at: utc(event.created_at)!, read: false } : null;
};

/** Builds the same `DemoState` snapshot `useDemoState` serves in local mode. */
export function buildState(snapshot: Snapshot, simulated: boolean, revision: number): DemoState {
  const cases = snapshot.cases.map((c) => mapCase(c, simulated));
  const emergencyCases = new Set(cases.filter((c) => c.is_emergency).map((c) => c.id));
  const approvals = snapshot.approvals.map((a) => mapApproval(a, emergencyCases));
  const replans = new Set(approvals.filter((a) => a.action === 'activate_replan').map((a) => a.plan_id));
  const changesByPlan = new Map<string, RouteChange[]>();
  for (const event of snapshot.events) if (event.type === 'plan.proposed' && typeof event.payload.plan_id === 'string') changesByPlan.set(event.payload.plan_id, mapChanges(event.payload.changes));
  const plans = snapshot.plans.map((p) => mapPlan(p, replans.has(p.id) ? 'replan' : 'initial', changesByPlan.get(p.id) ?? [], simulated));
  const active = plans.filter((p) => p.approved).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const assignments: Assignment[] = active ? active.workers.flatMap((route) => route.stops.map((stop, sequence) => ({ id: `a-${active.id}-${route.worker_id}-${sequence}`, plan_id: active.id, worker_id: route.worker_id, job_id: stop.job_id, eta: stop.eta, sequence, active: true }))) : [];
  const events = [...snapshot.events].sort((a, b) => b.sequence - a.sequence);
  return {
    schema_version: 1, revision, properties: snapshot.properties, reports: [], cases,
    workers: snapshot.workers.map((w) => mapWorker(w, snapshot.properties)), jobs: snapshot.jobs.map(mapJob),
    proposals: plans.filter((p) => !p.approved), active_plan: active, assignments, approvals,
    activity: events.map((e) => mapEvent(e, simulated)), notifications: events.map(eventNotice).filter((n): n is AppNotification => n !== null).slice(0, 20),
  };
}
