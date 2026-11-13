// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionStore } from '../connection';
import { ApiDataService } from './apiService';
import { reduceEvent, resourcesFor } from './events';
import { buildState, mapApproval, mapChanges, mapJob, mapWorker, utc, type BackendCase, type BackendEvent, type BackendJob, type BackendPlan, type Snapshot } from './mapping';
import { openStream } from './stream';

/* ---------------------------------------------------------------- fixtures */
const property = { id: 'p-001', display_address: 'Home p-001, Pitsmoor', postcode: 'S4', district: 'S4', area: 'Pitsmoor', lat: 53.40, lon: -1.44, archetype: 'terrace', floors: 2, bedrooms: 2, synthetic: true };
const backendCase: BackendCase = { id: 'case-1', hazard_type: 'gas', hhsrs_category: null, severity: 'emergency', is_emergency: true, room: null, vulnerable_occupants: [], summary: 'Gas smell', evidence: [], deadlines: { verified: false, review_required: true, notes: [] }, status: 'awaiting_approval', property_id: null, created_at: '2026-11-13T10:00:00', updated_at: '2026-11-13T10:00:00Z' };
const worker = { id: 'w-2', name: 'Dan Clarke', skills: ['general', 'plumbing', 'gas'] as const, shift_start: '2026-11-13T08:00:00', shift_end: '2026-11-13T16:00:00', lat: 53.401, lon: -1.441 };
const job: BackendJob = { id: 'job-case-1', case_id: 'case-1', property_id: 'p-001', required_skill: 'gas', duration_minutes: 60, lat: 53.4, lon: -1.44, earliest: '2026-11-13T10:00:00', latest: null, priority: 5, status: 'assigned', completion_notes: null, evidence_count: null, updated_at: null, source: 'case', hazard_type: 'gas', severity: 'emergency', access_notes: 'Side gate' };
const plan = (id: string, approved: boolean): BackendPlan => ({ id, solver: 'mock', solver_ms: 3, workers: [{ worker_id: 'w-2', stops: [{ job_id: 'job-case-1', eta: '2026-11-13T11:00:00', lat: 53.4, lon: -1.44, slack_minutes: 30 }] }], unassigned_jobs: [], conflicts: [], created_at: '2026-11-13T10:01:00', approved });
const event = (sequence: number, type: string, payload: Record<string, unknown> = {}, case_id: string | null = 'case-1'): BackendEvent => ({ sequence, id: `event-${sequence}`, case_id, type, summary: type, tool_name: null, payload, success: true, created_at: '2026-11-13T10:00:00' });
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({ cases: [backendCase], workers: [{ ...worker, skills: [...worker.skills] }], plans: [plan('plan-a', true)], approvals: [{ id: 'ap-1', case_id: 'case-1', action: 'commit_plan', payload: { plan_id: 'plan-a' }, status: 'approved', requested_at: '2026-11-13T10:00:00', decided_at: '2026-11-13T10:02:00', decided_by: 'officer', outcome: 'Approved' }], events: [], jobs: [job], properties: [property], ...over });

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>(); closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  close() { this.closed = true; }
  emit(item: BackendEvent) { const { sequence, ...data } = item; (this.listeners.get(item.type) ?? []).forEach((fn) => fn({ data: JSON.stringify(data), lastEventId: String(sequence) } as MessageEvent)); }
}

afterEach(() => { FakeEventSource.instances = []; vi.unstubAllGlobals(); connectionStore.set({ mode: 'local', status: 'live', simulatedServices: true, canReset: true, lastEventAt: null }); });

/* ---------------------------------------------------------------- mapping */
describe('backend → frontend schema mapping', () => {
  it('normalises naive UTC timestamps and nullable fields', () => {
    expect(utc('2026-11-13T10:00:00')).toBe('2026-11-13T10:00:00Z');
    expect(utc('2026-11-13T10:00:00+01:00')).toBe('2026-11-13T10:00:00+01:00');
    const state = buildState(snapshot(), true, 1);
    expect(state.cases[0]).toMatchObject({ property_id: '', created_at: '2026-11-13T10:00:00Z', simulated: true });
    expect(mapJob(job)).toMatchObject({ completion_notes: undefined, updated_at: '', earliest: '2026-11-13T10:00:00Z', access_notes: 'Side gate' });
  });

  it('derives worker role and base from skills and the nearest register property', () => {
    expect(mapWorker({ ...worker, skills: [...worker.skills] }, [property])).toMatchObject({ role: 'Multi-skilled operative', home_district: 'S4', shift_start: '2026-11-13T08:00:00Z' });
  });

  it('maps approvals, plan kinds, route changes and assignments', () => {
    expect(mapApproval({ id: 'a', case_id: 'case-1', action: 'commit_plan', payload: { plan_id: 'p' }, status: 'pending', requested_at: 'x', decided_at: null, decided_by: null, outcome: null }, new Set(['case-1'])))
      .toMatchObject({ plan_id: 'p', action: 'activate_replan' });
    expect(mapChanges({ added: [{ job_id: 'j1', to: 'w-1' }], moved: [{ job_id: 'j2', from: 'w-1', to: 'w-2' }], dropped: [] }))
      .toEqual([{ job_id: 'j1', to_worker_id: 'w-1', change: 'added' }, { job_id: 'j2', from_worker_id: 'w-1', to_worker_id: 'w-2', change: 'moved' }]);
    const state = buildState(snapshot({ plans: [plan('plan-a', true), plan('plan-b', false)] }), false, 1);
    expect(state.active_plan?.id).toBe('plan-a');
    expect(state.active_plan?.kind).toBe('replan');
    expect(state.proposals.map((p) => p.id)).toEqual(['plan-b']);
    expect(state.assignments).toEqual([expect.objectContaining({ worker_id: 'w-2', job_id: 'job-case-1', eta: '2026-11-13T11:00:00Z', active: true })]);
    expect(state.reports).toEqual([]);
  });
});

/* ---------------------------------------------------------------- reducer */
describe('SSE event reducer', () => {
  it('ignores duplicates and orders out-of-order events by sequence', () => {
    let s = snapshot();
    s = reduceEvent(s, event(5, 'case.updated')).snapshot;
    s = reduceEvent(s, event(3, 'case.created')).snapshot;
    const again = reduceEvent(s, event(5, 'case.updated'));
    expect(again.snapshot).toBe(s);
    expect(again.refetch).toEqual([]);
    expect(buildState(s, false, 1).activity.map((a) => a.sequence)).toEqual([5, 3]);
  });

  it('patches what the payload carries and lists what to refetch', () => {
    const s = snapshot();
    const progress = reduceEvent(s, event(7, 'job.progress', { job_id: 'job-case-1', status: 'on_site' }));
    expect(progress.snapshot.jobs[0]!.status).toBe('on_site');
    expect(progress.refetch).toEqual(['jobs']);
    const proposed = reduceEvent(s, event(8, 'plan.proposed', { plan_id: 'plan-c', plan: plan('plan-c', false) }));
    expect(proposed.snapshot.plans.map((p) => p.id)).toContain('plan-c');
    const status = reduceEvent(s, event(9, 'case.status_changed', { status: 'resolved' }));
    expect(status.snapshot.cases[0]!.status).toBe('resolved');
    expect(resourcesFor('system.reset')).toEqual(['all']);
    expect(resourcesFor('agent.run_started')).toEqual([]);
  });
});

/* ---------------------------------------------------------------- stream */
describe('event stream', () => {
  it('reconnects with backoff and resumes after the last sequence', () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const statuses: string[] = []; const received: number[] = []; let reconnects = 0;
    const stream = openStream({ url: (after) => `/api/stream?after=${after ?? 0}`, types: ['case.created'], after: 10, EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined, onStatus: (s) => statuses.push(s), onEvent: (e) => received.push(e.sequence), onReconnect: () => reconnects++ });
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toBe('/api/stream?after=10');
    first.onopen!(); first.emit(event(12, 'case.created'));
    first.onerror!(); first.onerror!();
    expect(first.closed).toBe(true);
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);
    timers[0]!.fn();
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toBe('/api/stream?after=12');
    second.onopen!();
    expect(reconnects).toBe(1);
    expect(received).toEqual([12]);
    expect(statuses).toEqual(['connecting', 'live', 'offline', 'offline', 'connecting', 'live']);
    stream.close();
    expect(second.closed).toBe(true);
  });
});

/* ---------------------------------------------------------------- service + useConnection */
function routeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const key = Object.keys(routes).find((path) => url.startsWith(path));
    if (!key) return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
const snapshotRoutes = (s = snapshot()) => ({ '/api/health': { status: 'ok', mocks: true, dev_reset: false }, '/api/cases': s.cases, '/api/workers': s.workers, '/api/plans': s.plans, '/api/approvals': s.approvals, '/api/events': [event(20, 'case.created')], '/api/jobs': s.jobs, '/api/properties': s.properties });

describe('api data service', () => {
  it('loads a snapshot, follows SSE, patches events and reports connection state', async () => {
    routeFetch(snapshotRoutes());
    const service = new ApiDataService({ EventSourceImpl: FakeEventSource as unknown as typeof EventSource, flushDelayMs: 0 });
    service.start();
    await vi.waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    expect(FakeEventSource.instances[0]!.url).toBe('/api/stream?after=20');
    expect(connectionStore.get()).toMatchObject({ mode: 'api', status: 'connecting', simulatedServices: true, canReset: false });
    expect(service.getState().workers[0]!.name).toBe('Dan Clarke');
    FakeEventSource.instances[0]!.onopen!();
    expect(connectionStore.get().status).toBe('live');
    FakeEventSource.instances[0]!.emit(event(21, 'job.progress', { job_id: 'job-case-1', status: 'travelling' }));
    expect(service.getState().jobs[0]!.status).toBe('travelling');
    expect(connectionStore.get().lastEventAt).not.toBeNull();
    FakeEventSource.instances[0]!.onerror!();
    expect(connectionStore.get().status).toBe('offline');
    service.stop();
  });

  it('surfaces backend validation messages as typed errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'A job cannot move from assigned to completed' }), { status: 409 })));
    const service = new ApiDataService();
    await expect(service.updateJobProgress('job-case-1', 'completed', 'x')).rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'A job cannot move from assigned to completed' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(service.findProperties('S4')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Cannot reach HomeShield/) });
  });

  it('keeps resident actions scoped: no case list, no stream, multipart only with media', async () => {
    const calls = routeFetch({ '/api/reports': { case: backendCase, plan: null }, '/api/properties': [property] });
    const service = new ApiDataService({ EventSourceImpl: FakeEventSource as unknown as typeof EventSource });
    expect((await service.findProperties('S4 7AA'))[0]!.id).toBe('p-001');
    const contact = { name: 'A', contact_number: '0700', preferred_contact: 'text' as const };
    await service.createReport({ text: 'Leak', category: 'leak', property_id: 'p-001', contact });
    await service.createReport({ category: 'damp_mould', property_id: '', contact, photo: new File(['x'], 'mould.jpg', { type: 'image/jpeg' }), postcode: 'S4 7AA' });
    expect(calls).toEqual(['GET /api/properties?q=S4%207AA&limit=20', 'POST /api/reports', 'POST /api/reports']);
    const [, jsonCall, formCall] = vi.mocked(fetch).mock.calls as Array<[string, RequestInit]>;
    expect(JSON.parse(jsonCall![1].body as string)).toMatchObject({ text: 'Leak', property_id: 'p-001', contact: { phone: '0700', preferred: 'text' } });
    const form = formCall![1].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(new Headers(formCall![1].headers).has('Content-Type')).toBe(false); // the browser sets the boundary
    expect(form.get('postcode')).toBe('S4 7AA');
    expect(form.get('property_id')).toBeNull();
    expect(form.get('text')).toMatch(/damp mould problem reported with a photo/);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
