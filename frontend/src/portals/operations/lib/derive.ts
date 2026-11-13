/**
 * Pure joins over the shared demo state. Every Operations counter, list, plan comparison and
 * timeline entry is derived here from `DemoState`; nothing is stored locally.
 */
import type { AgentActivity, Approval, Assignment, Case, CaseStatus, DemoState, Job, Property, SchedulePlan, Severity, Worker } from '../../../shared/types/domain';
import { HAZARD_LABEL, SEVERITY_LABEL, formatTime, humanise } from './format';
import type { LonLat } from './geo';

export const SEVERITY_RANK: Record<Severity, number> = { emergency: 0, significant: 1, moderate: 2, routine: 3 };
export const DUE_SOON_HOURS = 4;
export const EMERGENCY_CASE_ID = 'HS-EMERGENCY-1';

const DONE_JOB = new Set<Job['status']>(['completed', 'unable_to_complete']);
export const isOpenCase = (item: Case) => item.status !== 'resolved';
export const isEmergencyCase = (item: Case) => item.is_emergency || item.severity === 'emergency';

export interface Lookups {
  properties: Map<string, Property>;
  workers: Map<string, Worker>;
  jobs: Map<string, Job>;
  cases: Map<string, Case>;
  jobByCase: Map<string, Job>;
}

export function buildLookups(state: DemoState): Lookups {
  const jobByCase = new Map<string, Job>();
  for (const job of state.jobs) {
    const existing = jobByCase.get(job.case_id);
    // Prefer an outstanding job over a completed one when a case has several.
    if (!existing || (DONE_JOB.has(existing.status) && !DONE_JOB.has(job.status))) jobByCase.set(job.case_id, job);
  }
  return {
    properties: new Map(state.properties.map((item) => [item.id, item])),
    workers: new Map(state.workers.map((item) => [item.id, item])),
    jobs: new Map(state.jobs.map((item) => [item.id, item])),
    cases: new Map(state.cases.map((item) => [item.id, item])),
    jobByCase,
  };
}

export function pendingProposals(state: DemoState): SchedulePlan[] {
  const pending = new Set(state.approvals.filter((item) => item.status === 'pending').map((item) => item.plan_id));
  return state.proposals.filter((plan) => pending.has(plan.id) && !plan.approved).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export const approvalFor = (state: DemoState, planId: string): Approval | undefined => state.approvals.find((item) => item.plan_id === planId);

/* ---------------------------------------------------------------- deadlines */

export type DueTone = 'overdue' | 'soon' | 'later' | 'none';
export interface DueInfo { label: string; at: string | null; tone: DueTone; reviewRequired: boolean; verified: boolean; }

export function dueInfo(item: Case, job: Job | undefined, now: number): DueInfo {
  const candidates: Array<[string, string | null | undefined]> = [
    ['Make safe by', item.deadlines.make_safe_by],
    ['Investigate by', item.deadlines.investigate_by],
    ['Start works by', item.deadlines.start_works_by],
    ['Visit window ends', job?.latest],
  ];
  const dated = candidates.filter((entry): entry is [string, string] => Boolean(entry[1]) && !Number.isNaN(Date.parse(entry[1]!)))
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
  const base = { reviewRequired: item.deadlines.review_required, verified: item.deadlines.verified };
  const first = dated[0];
  if (!first || item.status === 'resolved') return { ...base, label: item.status === 'resolved' ? 'Resolved' : 'No deadline calculated', at: first?.[1] ?? null, tone: 'none' };
  const diff = Date.parse(first[1]) - now;
  const tone: DueTone = diff < 0 ? 'overdue' : diff <= DUE_SOON_HOURS * 3_600_000 ? 'soon' : 'later';
  return { ...base, label: `${first[0]} ${formatTime(first[1], now)}`, at: first[1], tone };
}

/* ---------------------------------------------------------------- case rows */

export interface CaseRow {
  case: Case;
  property?: Property;
  job?: Job;
  assignment?: Assignment;
  worker?: Worker;
  pendingPlan?: SchedulePlan;
  pendingWorker?: Worker;
  due: DueInfo;
  searchText: string;
}

export function buildCaseRows(state: DemoState, lookups: Lookups, now: number): CaseRow[] {
  const activeByJob = new Map(state.assignments.filter((item) => item.active).map((item) => [item.job_id, item]));
  const pending = pendingProposals(state);
  return state.cases.map((item) => {
    const property = lookups.properties.get(item.property_id);
    const job = lookups.jobByCase.get(item.id);
    const assignment = job ? activeByJob.get(job.id) : undefined;
    const worker = assignment ? lookups.workers.get(assignment.worker_id) : undefined;
    let pendingPlan: SchedulePlan | undefined; let pendingWorker: Worker | undefined;
    if (job) {
      for (const plan of pending) {
        const route = plan.workers.find((entry) => entry.stops.some((stop) => stop.job_id === job.id));
        if (route) { pendingPlan = plan; pendingWorker = lookups.workers.get(route.worker_id); break; }
      }
    }
    const searchText = [item.id, item.summary, HAZARD_LABEL[item.hazard_type], SEVERITY_LABEL[item.severity], item.room, property?.area, property?.district, property?.postcode, property?.display_address, worker?.name, pendingWorker?.name]
      .filter(Boolean).join(' ').toLowerCase();
    return { case: item, property, job, assignment, worker, pendingPlan, pendingWorker, due: dueInfo(item, job, now), searchText };
  });
}

export type UrgencyFilter = 'all' | Severity;
export type StatusFilter = 'all' | 'needs_action' | 'unassigned' | 'scheduled' | 'in_progress' | 'resolved';
export interface CaseFilters { query: string; urgency: UrgencyFilter; status: StatusFilter; }
export const DEFAULT_FILTERS: CaseFilters = { query: '', urgency: 'all', status: 'all' };

const NEEDS_ACTION = new Set<CaseStatus>(['new', 'investigating', 'awaiting_approval', 'escalated']);

export function matchesFilters(row: CaseRow, filters: CaseFilters): boolean {
  if (filters.urgency !== 'all' && row.case.severity !== filters.urgency) return false;
  switch (filters.status) {
    case 'needs_action': if (!NEEDS_ACTION.has(row.case.status)) return false; break;
    case 'unassigned': if (row.assignment || row.case.status === 'resolved') return false; break;
    case 'scheduled': if (row.case.status !== 'scheduled') return false; break;
    case 'in_progress': if (row.case.status !== 'in_progress') return false; break;
    case 'resolved': if (row.case.status !== 'resolved') return false; break;
    default: break;
  }
  const terms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => row.searchText.includes(term));
}

/** Open emergencies first, then severity, then nearest deadline, then newest. */
export function sortRows(rows: CaseRow[]): CaseRow[] {
  return [...rows].sort((a, b) => {
    const open = Number(isOpenCase(b.case)) - Number(isOpenCase(a.case)); if (open) return open;
    const severity = SEVERITY_RANK[a.case.severity] - SEVERITY_RANK[b.case.severity]; if (severity) return severity;
    const due = (a.due.at ? Date.parse(a.due.at) : Infinity) - (b.due.at ? Date.parse(b.due.at) : Infinity); if (due && Number.isFinite(due)) return due;
    return Date.parse(b.case.created_at) - Date.parse(a.case.created_at);
  });
}

/* ---------------------------------------------------------------- summary */

export interface OpsSummary { openCases: number; emergencies: number; jobsDueSoon: number; availableOperatives: number; totalOperatives: number; }

export function buildSummary(state: DemoState, lookups: Lookups, now: number): OpsSummary {
  const open = state.cases.filter(isOpenCase);
  const horizon = now + DUE_SOON_HOURS * 3_600_000;
  const jobsDueSoon = state.jobs.filter((job) => {
    if (DONE_JOB.has(job.status)) return false;
    const owner = lookups.cases.get(job.case_id);
    if (owner && !isOpenCase(owner)) return false;
    const due = owner ? dueInfo(owner, job, now).at : job.latest;
    return Boolean(due) && Date.parse(due!) <= horizon;
  }).length;
  const busy = new Set(state.assignments.filter((item) => item.active && !DONE_JOB.has(lookups.jobs.get(item.job_id)?.status ?? 'completed')).map((item) => item.worker_id));
  return {
    openCases: open.length,
    emergencies: open.filter(isEmergencyCase).length,
    jobsDueSoon,
    availableOperatives: state.workers.filter((worker) => !busy.has(worker.id)).length,
    totalOperatives: state.workers.length,
  };
}

/* ---------------------------------------------------------------- plans */

export interface PlanVisit {
  key: string; workerId: string; worker?: Worker; jobId: string; sequence: number; eta: string; slackMinutes: number | null;
  job?: Job; case?: Case; property?: Property;
}
export interface PlanRoute { workerId: string; worker?: Worker; visits: PlanVisit[]; }

export function planRoutes(plan: SchedulePlan | null | undefined, lookups: Lookups): PlanRoute[] {
  if (!plan) return [];
  return plan.workers.map((route) => ({
    workerId: route.worker_id,
    worker: lookups.workers.get(route.worker_id),
    visits: route.stops.map((stop, index) => {
      const job = lookups.jobs.get(stop.job_id);
      return { key: `${plan.id}:${route.worker_id}:${stop.job_id}`, workerId: route.worker_id, worker: lookups.workers.get(route.worker_id), jobId: stop.job_id, sequence: index + 1, eta: stop.eta, slackMinutes: stop.slack_minutes, job, case: job ? lookups.cases.get(job.case_id) : undefined, property: job ? lookups.properties.get(job.property_id) : undefined };
    }),
  }));
}

export interface ResolvedChange { key: string; change: 'added' | 'moved' | 'dropped'; jobId: string; job?: Job; case?: Case; from?: Worker; to?: Worker; }
export interface PlanComparison {
  changes: ResolvedChange[];
  /** Visits in the active plan that the proposal does not contain. In the shared mock, activation replaces the whole plan. */
  released: PlanVisit[];
  unassigned: Array<{ jobId: string; job?: Job; case?: Case }>;
  conflicts: string[];
}

export function comparePlans(active: SchedulePlan | null | undefined, proposal: SchedulePlan, lookups: Lookups): PlanComparison {
  const proposedJobs = new Set(proposal.workers.flatMap((route) => route.stops.map((stop) => stop.job_id)));
  const released = planRoutes(active, lookups).flatMap((route) => route.visits).filter((visit) => !proposedJobs.has(visit.jobId));
  const changes = proposal.changes.map((entry, index) => {
    const job = lookups.jobs.get(entry.job_id);
    return { key: `${entry.job_id}-${entry.change}-${index}`, change: entry.change, jobId: entry.job_id, job, case: job ? lookups.cases.get(job.case_id) : undefined, from: entry.from_worker_id ? lookups.workers.get(entry.from_worker_id) : undefined, to: entry.to_worker_id ? lookups.workers.get(entry.to_worker_id) : undefined };
  });
  const unassigned = proposal.unassigned_jobs.map((jobId) => { const job = lookups.jobs.get(jobId); return { jobId, job, case: job ? lookups.cases.get(job.case_id) : undefined }; });
  return { changes, released, unassigned, conflicts: proposal.conflicts };
}

/* ---------------------------------------------------------------- map scene */

export interface CaseMarker {
  propertyId: string; position: LonLat; floors: number; severity: Severity; emergency: boolean;
  caseIds: string[]; primaryCaseId: string; label: string; area: string;
}
export interface WorkerMarker { id: string; name: string; role: string; position: LonLat; initials: string; busy: boolean; }
export interface RouteDatum { id: string; workerId: string; planId: string; path: LonLat[]; status: 'active' | 'proposed'; }
export interface StopDatum { id: string; position: LonLat; sequence: number; status: 'active' | 'proposed'; jobId: string; caseId?: string; workerId: string; }

export function buildCaseMarkers(state: DemoState, lookups: Lookups): CaseMarker[] {
  const byProperty = new Map<string, Case[]>();
  for (const item of state.cases) {
    if (!isOpenCase(item)) continue;
    const list = byProperty.get(item.property_id) ?? []; list.push(item); byProperty.set(item.property_id, list);
  }
  const markers: CaseMarker[] = [];
  for (const [propertyId, cases] of byProperty) {
    const property = lookups.properties.get(propertyId); if (!property) continue;
    const sorted = [...cases].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const primary = sorted[0]!;
    markers.push({ propertyId, position: [property.lon, property.lat], floors: property.floors, severity: primary.severity, emergency: sorted.some(isEmergencyCase), caseIds: sorted.map((c) => c.id), primaryCaseId: primary.id, label: sorted.length > 1 ? `${primary.id} +${sorted.length - 1}` : primary.id, area: property.area });
  }
  // Draw the most severe last so it sits on top.
  return markers.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function buildWorkerMarkers(state: DemoState, lookups: Lookups): WorkerMarker[] {
  const busy = new Set(state.assignments.filter((item) => item.active && !DONE_JOB.has(lookups.jobs.get(item.job_id)?.status ?? 'completed')).map((item) => item.worker_id));
  return state.workers.map((worker) => ({ id: worker.id, name: worker.name, role: worker.role, position: [worker.lon, worker.lat], initials: worker.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(), busy: busy.has(worker.id) }));
}

/** Routes are schematic: straight connections between the operative's base and ordered stop waypoints. */
export function buildRoutes(plan: SchedulePlan | null | undefined, lookups: Lookups, status: RouteDatum['status']): { routes: RouteDatum[]; stops: StopDatum[] } {
  if (!plan) return { routes: [], stops: [] };
  const routes: RouteDatum[] = []; const stops: StopDatum[] = [];
  for (const route of plan.workers) {
    const worker = lookups.workers.get(route.worker_id);
    const waypoints = route.stops.map((stop) => [stop.lon, stop.lat] as LonLat);
    const path = worker ? [[worker.lon, worker.lat] as LonLat, ...waypoints] : waypoints;
    if (path.length >= 2) routes.push({ id: `${status}:${plan.id}:${route.worker_id}`, workerId: route.worker_id, planId: plan.id, path, status });
    route.stops.forEach((stop, index) => stops.push({ id: `${status}:${plan.id}:${route.worker_id}:${stop.job_id}`, position: [stop.lon, stop.lat], sequence: index + 1, status, jobId: stop.job_id, caseId: lookups.jobs.get(stop.job_id)?.case_id, workerId: route.worker_id }));
  }
  return { routes, stops };
}

/* ---------------------------------------------------------------- timeline */

export type TimelineSource = 'activity log' | 'case record' | 'approval record';
export interface TimelineEntry { id: string; at: string; title: string; summary: string; source: TimelineSource; caseId: string | null; tone: 'info' | 'warning' | 'success' | 'critical' | 'neutral'; order: number; }

const ACTIVITY_TITLES: Record<string, { title: string; tone: TimelineEntry['tone'] }> = {
  'report.received': { title: 'Report received', tone: 'info' },
  'schedule.requested': { title: 'Scheduling requested', tone: 'info' },
  'plan.proposed': { title: 'Schedule result returned', tone: 'warning' },
  'plan.replan_completed': { title: 'Emergency re-plan returned', tone: 'critical' },
  'plan.activated': { title: 'Plan activated', tone: 'success' },
  'plan.rejected': { title: 'Proposal rejected', tone: 'neutral' },
  'job.progress': { title: 'Job progress', tone: 'info' },
  'demo.ready': { title: 'Demonstration ready', tone: 'neutral' },
};

export function buildTimeline(state: DemoState, caseId?: string | null): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const include = (id: string | null) => !caseId || id === caseId;
  state.activity.forEach((event: AgentActivity) => {
    if (!include(event.case_id)) return;
    const meta = ACTIVITY_TITLES[event.type] ?? { title: humanise(event.type), tone: 'neutral' as const };
    entries.push({ id: event.id, at: event.created_at, title: meta.title, summary: event.summary, source: 'activity log', caseId: event.case_id, tone: event.success === false ? 'critical' : meta.tone, order: event.type === 'report.received' ? 0 : 3 });
  });
  state.cases.forEach((item) => {
    if (!include(item.id)) return;
    entries.push({ id: `${item.id}:classification`, at: item.created_at, title: 'Classification proposed', summary: `Simulated classification for ${item.id}: ${HAZARD_LABEL[item.hazard_type]}, ${SEVERITY_LABEL[item.severity].toLowerCase()}. Not an official determination.`, source: 'case record', caseId: item.id, tone: isEmergencyCase(item) ? 'critical' : 'warning', order: 1 });
    const { investigate_by, make_safe_by, start_works_by, review_required } = item.deadlines;
    const dated = [['make safe', make_safe_by], ['investigate', investigate_by], ['start works', start_works_by]].filter(([, at]) => at).map(([label, at]) => `${label} by ${formatTime(at)}`);
    entries.push({ id: `${item.id}:deadlines`, at: item.created_at, title: 'Deadlines calculated', summary: dated.length ? `Simulated deadlines for ${item.id}: ${dated.join(', ')}.${review_required ? ' Officer review required.' : ''}` : `No deadlines were calculated for ${item.id}. Officer review required.`, source: 'case record', caseId: item.id, tone: 'warning', order: 2 });
  });
  state.approvals.forEach((approval) => {
    if (!include(approval.case_id)) return;
    entries.push({ id: `${approval.id}:requested`, at: approval.requested_at, title: 'Approval requested', summary: `${approval.action === 'activate_replan' ? 'Re-plan' : 'Schedule'} ${approval.plan_id} awaits a housing officer decision${approval.status !== 'pending' ? ` (now ${approval.status})` : ''}.`, source: 'approval record', caseId: approval.case_id, tone: approval.status === 'pending' ? 'warning' : 'neutral', order: 4 });
  });
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.order - a.order);
}
