import { connectionStore } from '../connection';
import type { AgentActivity, Case, CreateReportInput, DemoState, Job, JobStatus, MockService, Property, Report, SchedulePlan } from '../../types/domain';
import { EVENT_TYPES, reduceEvent, type Resource } from './events';
import { ApiError, json, request } from './http';
import { buildState, mapCase, mapChanges, mapJob, mapPlan, type BackendApproval, type BackendCase, type BackendEvent, type BackendJob, type BackendPlan, type BackendWorker, type Health, type Snapshot } from './mapping';
import { backoff, openStream } from './stream';

const EMPTY: Snapshot = { cases: [], workers: [], plans: [], approvals: [], events: [], jobs: [], properties: [] };
const upsert = <T extends { id: string }>(items: T[], item: T) => [item, ...items.filter((existing) => existing.id !== item.id)];
const pendingFor = (approvals: BackendApproval[], planId: string) => approvals.find((a) => a.status === 'pending' && a.payload.plan_id === planId);

/**
 * `api` mode: HTTP + SSE to FastAPI behind the `MockService` interface.
 * Nothing is fetched until `start()` (staff app only), so the resident app never downloads the case list.
 */
export class ApiDataService implements MockService {
  private raw: Snapshot = EMPTY;
  private state: DemoState = buildState(EMPTY, false, 0);
  private localActivity: AgentActivity[] = [];
  private listeners = new Set<() => void>();
  private simulated = false;
  private started = false;
  private stream: ReturnType<typeof openStream> | null = null;
  private pending = new Set<Resource>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private loadAttempt = 0;

  constructor(private readonly options: { EventSourceImpl?: typeof EventSource; flushDelayMs?: number } = {}) {}

  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getCases = () => this.state.cases;
  getProperties = () => this.state.properties;
  getWorkers = () => this.state.workers;
  getAssignedJobs = (workerId: string) => { const ids = new Set(this.state.assignments.filter((a) => a.active && a.worker_id === workerId).map((a) => a.job_id)); return this.state.jobs.filter((job) => ids.has(job.id)); };

  /** Staff app: load the full snapshot and follow `/api/stream`. Safe to call repeatedly. */
  start() { if (this.started) return; this.started = true; void this.load(); }
  stop() { this.started = false; this.stream?.close(); this.stream = null; [this.flushTimer, this.retryTimer].forEach((t) => t && clearTimeout(t)); }

  private rebuild(raw: Snapshot) {
    this.raw = raw;
    const built = buildState(raw, this.simulated, this.state.revision + 1);
    this.state = this.localActivity.length ? { ...built, activity: [...this.localActivity, ...built.activity] } : built;
    this.listeners.forEach((listener) => listener());
  }

  async health() {
    const health = await request<Health>('/health');
    this.simulated = health.mocks;
    connectionStore.set({ mode: 'api', simulatedServices: health.mocks, canReset: Boolean(health.dev_reset) });
    return health;
  }

  private async load(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    connectionStore.set({ status: 'connecting' });
    try {
      await this.health();
      const [cases, workers, plans, approvals, events, jobs, properties] = await Promise.all([
        request<BackendCase[]>('/cases'), request<BackendWorker[]>('/workers'), request<BackendPlan[]>('/plans'),
        request<BackendApproval[]>('/approvals'), request<BackendEvent[]>('/events?tail=300'), request<BackendJob[]>('/jobs'),
        this.raw.properties.length ? Promise.resolve(this.raw.properties) : request<Property[]>('/properties?limit=500'),
      ]);
      this.loadAttempt = 0;
      this.rebuild({ cases, workers, plans, approvals, events, jobs, properties });
      if (!this.stream && this.started) this.follow(events.reduce((max, e) => Math.max(max, e.sequence), 0));
    } catch {
      connectionStore.set({ status: 'offline' });
      if (this.started) this.retryTimer = setTimeout(() => void this.load(), backoff(this.loadAttempt++));
    }
  }

  private follow(after: number) {
    this.stream = openStream({
      url: (cursor) => `/api/stream?after=${cursor ?? after}`, types: EVENT_TYPES, after,
      EventSourceImpl: this.options.EventSourceImpl,
      onStatus: (status) => connectionStore.set({ status }),
      onReconnect: () => this.queue(['all']),
      onEvent: (event) => {
        connectionStore.set({ lastEventAt: new Date().toISOString() });
        const { snapshot, refetch } = reduceEvent(this.raw, event);
        if (snapshot !== this.raw) this.rebuild(snapshot);
        this.queue(refetch);
      },
    });
  }

  private queue(resources: Resource[]) {
    if (!resources.length) return;
    resources.forEach((r) => this.pending.add(r));
    this.flushTimer ??= setTimeout(() => void this.flush(), this.options.flushDelayMs ?? 150);
  }

  /** Refetches only the resources invalidated since the last flush (events in a burst are coalesced). */
  async flush() {
    this.flushTimer = null;
    const wanted = new Set(this.pending); this.pending.clear();
    if (!wanted.size) return;
    if (wanted.has('all')) return this.load();
    try {
      const [cases, plans, approvals, jobs] = await Promise.all([
        wanted.has('cases') ? request<BackendCase[]>('/cases') : this.raw.cases,
        wanted.has('plans') ? request<BackendPlan[]>('/plans') : this.raw.plans,
        wanted.has('approvals') ? request<BackendApproval[]>('/approvals') : this.raw.approvals,
        wanted.has('jobs') ? request<BackendJob[]>('/jobs') : this.raw.jobs,
      ]);
      this.rebuild({ ...this.raw, cases, plans, approvals, jobs });
    } catch { wanted.forEach((r) => this.pending.add(r)); this.flushTimer ??= setTimeout(() => void this.flush(), 2000); }
  }

  async findProperties(query: string) {
    return request<Property[]>(`/properties?q=${encodeURIComponent(query.trim())}&limit=20`);
  }

  async createReport(input: CreateReportInput) {
    const media = [input.photo && 'a photo', input.audio && 'a voice note'].filter(Boolean).join(' and ');
    const text = input.text?.trim() || `${input.category.replaceAll('_', ' ')} problem reported with ${media || 'no description'}`;
    const contact = { name: input.contact.name || undefined, phone: input.contact.contact_number || undefined, email: input.contact.email || undefined, preferred: input.contact.preferred_contact, access_notes: input.contact.access_notes || undefined };
    let init: RequestInit;
    if (input.photo || input.audio) {
      const form = new FormData();
      const fields: Record<string, string | undefined> = { text, property_id: input.property_id || undefined, contact_name: contact.name, contact_phone: contact.phone, contact_email: contact.email, contact_preferred: contact.preferred, access_notes: contact.access_notes, address_line: input.address_line, postcode: input.postcode };
      Object.entries(fields).forEach(([key, value]) => { if (value) form.append(key, value); });
      if (input.photo) form.append('photo', input.photo, input.photo instanceof File ? input.photo.name : 'photo');
      if (input.audio) form.append('audio', input.audio, input.audio instanceof File ? input.audio.name : 'voice-note');
      init = { method: 'POST', body: form };
    } else {
      init = json({ text, property_id: input.property_id || undefined, contact, address_line: input.address_line || undefined, postcode: input.postcode || undefined });
    }
    const body = await request<{ case: BackendCase }>('/reports', init);
    const created = mapCase(body.case, this.simulated);
    const report: Report = { id: `report-${created.id}`, text, category: input.category, property_id: created.property_id, contact: input.contact, evidence: created.evidence, submitted_at: created.created_at, simulated: this.simulated };
    if (this.started) this.queue(['cases', 'plans', 'approvals', 'jobs']);
    return { report, case: created };
  }

  async generateScheduleProposal(caseId?: string) {
    const target = caseId ?? this.state.jobs.find((job) => job.status === 'unassigned' && job.source === 'case')?.case_id;
    if (!target) throw new ApiError('There are no unscheduled reports to plan.', 409);
    const plan = await request<BackendPlan>('/agent/tools/schedule_job', json({ case_id: target }));
    await request('/agent/tools/request_approval', json({ case_id: target, action: 'commit_plan' }));
    this.rebuild({ ...this.raw, plans: upsert(this.raw.plans, plan) });
    this.queue(['approvals', 'jobs']);
    return mapPlan(plan, 'initial', [], this.simulated);
  }

  private async decide(planId: string, verb: 'approve' | 'reject', body: object) {
    let approval = pendingFor(this.raw.approvals, planId);
    if (!approval) { const approvals = await request<BackendApproval[]>('/approvals?status=pending'); approval = pendingFor(approvals, planId); }
    if (!approval) throw new ApiError('This proposal is no longer waiting for a decision.', 409);
    await request(`/approvals/${encodeURIComponent(approval.id)}/${verb}`, json(body));
    const [plans, approvals, jobs, cases] = await Promise.all([request<BackendPlan[]>('/plans'), request<BackendApproval[]>('/approvals'), request<BackendJob[]>('/jobs'), request<BackendCase[]>('/cases')]);
    this.rebuild({ ...this.raw, plans, approvals, jobs, cases });
  }

  async approveProposal(planId: string, decidedBy = 'housing-officer') {
    await this.decide(planId, 'approve', { decided_by: decidedBy });
    const plan = [this.state.active_plan, ...this.state.proposals].find((p) => p?.id === planId);
    if (!plan) throw new ApiError('The approved plan could not be loaded. Refresh to see the latest schedule.', 404);
    return plan;
  }

  async rejectProposal(planId: string, reason: string, decidedBy = 'housing-officer') {
    await this.decide(planId, 'reject', { decided_by: decidedBy, reason });
  }

  async simulateEmergency(): Promise<{ case: Case; proposal: SchedulePlan }> {
    const body = await request<{ case: BackendCase; plan: BackendPlan | null }>('/emergency', json({ text: 'Strong smell of gas in the kitchen of a flat; the residents have gone outside.', property_id: 'p-110' }));
    if (!body.plan) throw new ApiError('The emergency was recorded, but scheduling did not produce a re-plan. Retry scheduling from the case.', 503);
    const changes = this.raw.events.find((e) => e.type === 'plan.proposed' && e.payload.plan_id === body.plan!.id)?.payload.changes;
    if (this.started) this.queue(['cases', 'approvals', 'jobs']);
    return { case: mapCase(body.case, this.simulated), proposal: mapPlan(body.plan, 'replan', mapChanges(changes), this.simulated) };
  }

  async updateJobProgress(jobId: string, status: JobStatus, notes?: string, evidenceCount?: number): Promise<Job> {
    const job = await request<BackendJob>(`/jobs/${encodeURIComponent(jobId)}/progress`, json({ status, notes: notes?.trim() || undefined, evidence_count: evidenceCount }));
    this.rebuild({ ...this.raw, jobs: this.raw.jobs.map((item) => item.id === job.id ? job : item) });
    this.queue(['cases']);
    return mapJob(job);
  }

  /** Activity recorded in the browser only; the backend audit log is written by the backend itself. */
  async recordActivity(input: Pick<AgentActivity, 'case_id' | 'type' | 'summary'> & Partial<AgentActivity>) {
    const event: AgentActivity = { id: `local-${Date.now()}`, tool_name: null, payload: {}, success: true, created_at: new Date().toISOString(), ...input, simulated: this.simulated };
    this.localActivity = [event, ...this.localActivity].slice(0, 50);
    this.rebuild(this.raw);
    return event;
  }

  async reset() {
    if (!connectionStore.get().canReset) throw new ApiError('Reset is turned off on this server.', 403);
    await request('/dev/reset', { method: 'POST' });
    this.localActivity = [];
    await this.load();
  }
}
