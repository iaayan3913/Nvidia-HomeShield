import type { BackendEvent, BackendPlan, Snapshot } from './mapping';

/** Named SSE event types the backend emits. EventSource has no wildcard, so each is registered. */
export const EVENT_TYPES = [
  'report.received', 'case.created', 'case.updated', 'case.status_changed', 'intake.completed', 'intake.media_unavailable',
  'deadline.calculated', 'deadline.review_required', 'emergency.created',
  'plan.proposed', 'plan.replan_started', 'plan.replan_completed', 'plan.updated', 'plan.conflicts', 'plan.failed',
  'plan.approved', 'plan.rejected', 'plan.activated', 'plan.recovery_started',
  'approval.requested', 'approval.approved', 'approval.rejected', 'job.progress', 'system.reset',
  'agent.run_started', 'agent.action_result', 'agent.run_completed', 'agent.tool_requested', 'agent.tool_completed', 'agent.tool_failed',
] as const;

export type Resource = 'cases' | 'plans' | 'approvals' | 'jobs' | 'all';
const MAX_EVENTS = 300;

/** Which resources an event invalidates and must be refetched. Unknown types only join the activity feed. */
export function resourcesFor(type: string): Resource[] {
  if (type === 'system.reset') return ['all'];
  if (type.startsWith('job.')) return ['jobs'];
  if (type.startsWith('approval.')) return ['approvals', 'plans', 'cases', 'jobs'];
  if (type === 'plan.proposed' || type === 'plan.activated' || type === 'plan.updated' || type === 'plan.replan_completed') return ['jobs'];
  if (type.startsWith('plan.')) return ['plans', 'jobs'];
  if (/^(case|report|intake|deadline|emergency)\./.test(type)) return ['cases', 'jobs'];
  return [];
}

const upsert = <T extends { id: string }>(items: T[], item: T) => [item, ...items.filter((existing) => existing.id !== item.id)];

/**
 * Applies one SSE event to the raw snapshot. Duplicates are ignored and out-of-order events are
 * placed by sequence. Where the payload carries the new data (plans, job and case status) it is
 * patched in immediately; `refetch` lists what still has to be reloaded.
 */
export function reduceEvent(snapshot: Snapshot, event: BackendEvent): { snapshot: Snapshot; refetch: Resource[] } {
  if (snapshot.events.some((item) => item.id === event.id)) return { snapshot, refetch: [] };
  const events = [...snapshot.events, event].sort((a, b) => a.sequence - b.sequence).slice(-MAX_EVENTS);
  let next: Snapshot = { ...snapshot, events };
  const plan = event.payload.plan as BackendPlan | undefined;
  if (plan && typeof plan.id === 'string' && Array.isArray(plan.workers)) next = { ...next, plans: upsert(next.plans, plan) };
  const { job_id: jobId, status } = event.payload as { job_id?: unknown; status?: unknown };
  if (event.type === 'job.progress' && typeof jobId === 'string' && typeof status === 'string') {
    next = { ...next, jobs: next.jobs.map((job) => job.id === jobId ? { ...job, status: status as typeof job.status } : job) };
  }
  if (event.type === 'case.status_changed' && event.case_id && typeof status === 'string') {
    next = { ...next, cases: next.cases.map((item) => item.id === event.case_id ? { ...item, status: status as typeof item.status } : item) };
  }
  return { snapshot: next, refetch: resourcesFor(event.type) };
}
