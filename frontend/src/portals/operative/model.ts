import type { Case, DemoState, Job, JobStatus, Property, Report } from '../../shared/types/domain';

export interface WorkItem { job: Job; case?: Case; property?: Property; report?: Report; eta: string; sequence: number; }

export const FINISHED: JobStatus[] = ['completed', 'unable_to_complete'];
export const isFinished = (status: JobStatus) => FINISHED.includes(status);

/** Active approved assignments only (never proposals), joined by ID and ordered by ETA. */
export function workItemsFor(state: DemoState, workerId: string): WorkItem[] {
  const planId = state.active_plan?.approved ? state.active_plan.id : null;
  if (!planId) return [];
  return state.assignments
    .filter((a) => a.active && a.plan_id === planId && a.worker_id === workerId)
    .flatMap((a) => {
      const job = state.jobs.find((j) => j.id === a.job_id);
      if (!job) return [];
      const housingCase = state.cases.find((c) => c.id === job.case_id);
      return [{
        job, case: housingCase, eta: a.eta, sequence: a.sequence,
        property: state.properties.find((p) => p.id === job.property_id),
        report: housingCase?.report_id ? state.reports.find((r) => r.id === housingCase.report_id) : undefined,
      }];
    })
    .sort((x, y) => x.eta.localeCompare(y.eta) || x.sequence - y.sequence);
}

/** Pending proposals that mention this worker — shown only as a count, never as work. */
export function pendingProposalCount(state: DemoState, workerId: string) {
  const pending = new Set(state.approvals.filter((a) => a.status === 'pending').map((a) => a.plan_id));
  return state.proposals.filter((p) => pending.has(p.id) && p.workers.some((w) => w.worker_id === workerId && w.stops.length)).length;
}

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
export const formatTime = (iso: string | null | undefined) => (iso ? time.format(new Date(iso)) : '—');
export const timeWindow = (job: Job) => job.earliest || job.latest ? `${formatTime(job.earliest)}–${formatTime(job.latest)}` : 'No fixed window';
export const humanise = (value: string) => value.replaceAll('_', ' ');

export type PriorityLevel = 'emergency' | 'urgent' | 'high' | 'standard';
export function priorityOf(item: WorkItem): { level: PriorityLevel; label: string } {
  if (item.case?.is_emergency || item.job.priority >= 5) return { level: 'emergency', label: 'Emergency' };
  if (item.job.priority === 4) return { level: 'urgent', label: 'Urgent' };
  if (item.job.priority === 3) return { level: 'high', label: 'High priority' };
  return { level: 'standard', label: 'Standard' };
}

export function straightLineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180; const dLat = (b.lat - a.lat) * rad; const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Next allowed progress steps from the current job status. */
export const NEXT_STEP: Partial<Record<JobStatus, { status: JobStatus; label: string }>> = {
  unassigned: { status: 'travelling', label: 'Start travelling' },
  assigned: { status: 'travelling', label: 'Start travelling' },
  travelling: { status: 'on_site', label: 'Arrived on site' },
  on_site: { status: 'completed', label: 'Complete job' },
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  unassigned: 'Not started', assigned: 'Assigned', travelling: 'Travelling', on_site: 'On site', completed: 'Completed', unable_to_complete: 'Unable to complete',
};
