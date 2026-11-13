// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiHomeShieldService } from './ApiHomeShieldService';
import { jobsFromPlans, mapCase, mapPlan, mapProperty } from './mappers';
import type { ApiCase, ApiPlan } from './apiTypes';

const apiCase: ApiCase = {
  id: 'case-1', hazard_type: 'damp_mould', hhsrs_category: 'Damp and mould growth', severity: 'significant',
  is_emergency: false, room: 'bedroom', vulnerable_occupants: ['asthma'], summary: 'Bedroom mould', evidence: [],
  deadlines: { investigate_by: '2026-11-14T09:00:00Z', verified: true }, status: 'awaiting_approval',
  property_id: 'p-001', created_at: '2026-11-13T09:00:00Z', updated_at: '2026-11-13T09:01:00Z',
};
const proposed: ApiPlan = { id: 'plan-new', solver: 'ortools', solver_ms: 12, approved: false, created_at: '2026-11-13T09:02:00Z', workers: [{ worker_id: 'w-1', stops: [{ job_id: 'job-case-1', eta: '2026-11-13T11:00:00Z', lat: 53.4, lon: -1.45 }] }], unassigned_jobs: [], conflicts: [] };
const active: ApiPlan = { ...proposed, id: 'plan-active', approved: true, solver: 'mock', workers: [{ worker_id: 'w-2', stops: [{ job_id: 'job-case-1', eta: '2026-11-13T12:00:00Z', lat: 53.4, lon: -1.45 }] }] };
const worker = { id: 'w-1', name: 'Alex', skills: ['damp_mould'], shift_start: '08:00', shift_end: '16:00', lat: 53.4, lon: -1.45 };
const approval = { id: 'approval-1', case_id: 'case-1', action: 'activate_plan', payload: { plan_id: 'plan-new' }, status: 'pending', requested_at: '2026-11-13T09:02:00Z' };
const event = { id: 'event-1', sequence: 1, case_id: 'case-1', type: 'case.created', summary: 'Case created', payload: {}, created_at: '2026-11-13T09:00:00Z' };

function response(value: unknown, status = 200) { return new Response(value === null ? '' : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function apiFetch(options: { report?: unknown; latest?: ApiPlan | null; active?: ApiPlan | null } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/sample-properties.json') return response([{ id: 'p-001', lat: 53.4, lon: -1.45, district: 'S4', area: 'Pitsmoor', archetype: 'flat', floors: 2 }]);
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.endsWith('/api/cases')) return response([apiCase]);
    if (url.endsWith('/api/workers')) return response([worker]);
    if (url.includes('/api/plans/latest')) return options.latest === null ? response({ detail: 'none' }, 404) : response(options.latest ?? proposed);
    if (url.includes('/api/plans/active')) return options.active === null ? response({ detail: 'none' }, 404) : response(options.active ?? active);
    if (url.includes('/api/approvals/') && init?.method === 'POST') return response({ ...approval, status: 'approved' });
    if (url.endsWith('/api/approvals')) return response([approval]);
    if (url.includes('/api/events')) return response([event]);
    if (url.endsWith('/api/reports')) return response(options.report ?? { case: apiCase, plan: proposed, approval, warnings: ['Media stored but analysis unavailable'] });
    if (url.endsWith('/api/emergency')) return response(options.report ?? { case: { ...apiCase, id: 'case-emergency', is_emergency: true, severity: 'emergency' }, plan: null, warnings: ['scheduler unavailable'] });
    if (url.endsWith('/api/agent/tools/schedule_job')) return response(proposed);
    if (url.includes('/api/plans/')) return response(active);
    throw new Error(`Unexpected request: ${url}`);
  });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null; onerror: (() => void) | null = null; closed = false;
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(name: string, listener: EventListenerOrEventListenerObject) { const fn = listener as (event: MessageEvent) => void; this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
  close() { this.closed = true; }
  emit(name: string, id = 'sse-1') { this.listeners.get(name)?.forEach((fn) => fn(new MessageEvent(name, { data: JSON.stringify({ id }), lastEventId: id }))); }
}

describe('API adapters', () => {
  beforeEach(() => { FakeEventSource.instances = []; vi.stubGlobal('EventSource', FakeEventSource); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('maps known fields, safely defaults unknown values, and joins cases to properties/jobs', () => {
    const mapped = mapCase({ ...apiCase, hazard_type: 'unexpected', severity: 'catastrophic', status: 'mystery' });
    expect(mapped).toMatchObject({ hazard_type: 'other', severity: 'routine', status: 'new', property_id: 'p-001', simulated: false });
    const property = mapProperty({ id: 'p-001', lat: 53.4, lon: -1.45, district: 'S4' });
    expect(property).toMatchObject({ id: mapped.property_id, synthetic: true, lat: 53.4 });
    expect(jobsFromPlans([mapPlan(active)], [mapCase(apiCase)])[0]).toMatchObject({ case_id: 'case-1', property_id: 'p-001', status: 'assigned' });
  });

  it('checks health and keeps proposed routes separate from approved assignments', async () => {
    const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock);
    const service = new ApiHomeShieldService('http://spark.test:8100'); await service.start();
    expect(service.getConnection().status).toBe('connected');
    FakeEventSource.instances[0]!.onopen?.();
    expect(service.getConnection().status).toBe('connected');
    expect(service.getState().proposals[0]?.id).toBe('plan-new');
    expect(service.getState().active_plan?.id).toBe('plan-active');
    expect(service.getState().assignments).toHaveLength(1);
    expect(service.getState().assignments[0]?.worker_id).toBe('w-2');
    service.stop();
  });

  it('submits JSON and multipart reports without forcing a multipart content type, preserving warnings', async () => {
    const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock); const service = new ApiHomeShieldService('http://api');
    const input = { text: 'Mould in bedroom', category: 'damp_mould' as const, property_id: 'p-001', contact: { name: 'Resident', contact_number: '07000', preferred_contact: 'text' as const } };
    const jsonResult = await service.createReport(input);
    const jsonCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!;
    expect(jsonCall[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(jsonResult.warnings).toContain('Media stored but analysis unavailable');

    fetchMock.mockClear();
    const photo1 = new File(['one'], 'one.jpg', { type: 'image/jpeg' }); const photo2 = new File(['two'], 'two.jpg', { type: 'image/jpeg' });
    const audio = new Blob(['voice'], { type: 'audio/webm' });
    const multipartResult = await service.createReport(input, { photos: [photo1, photo2], audio, audioName: 'note.webm' });
    const multipartCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!;
    expect(multipartCall[1]?.body).toBeInstanceOf(FormData); expect(multipartCall[1]?.headers).toBeUndefined();
    expect((multipartCall[1]?.body as FormData).get('photo')).toBe(photo1);
    expect((multipartCall[1]?.body as FormData).get('audio')).toBeInstanceOf(Blob);
    expect(multipartResult.warnings.join(' ')).toMatch(/accepts one photo/);
  });

  it('surfaces validation errors, sends approval decisions, and reports emergency scheduling failure honestly', async () => {
    const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock); const service = new ApiHomeShieldService('http://api'); await service.refresh();
    await service.approveProposal('plan-new', 'officer-1');
    const approvalCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/approval-1/approve'))!;
    expect(JSON.parse(String(approvalCall[1]?.body))).toEqual({ decided_by: 'officer-1' });
    const emergency = await service.simulateEmergency(); expect(emergency.proposal).toBeNull(); expect(emergency.warnings).toContain('scheduler unavailable');

    vi.stubGlobal('fetch', vi.fn(async () => response({ detail: 'Unsupported media type' }, 415)));
    await expect(service.createReport({ text: 'x', category: 'other', property_id: 'p-001', contact: { name: 'R', contact_number: '0', preferred_contact: 'phone' } })).rejects.toEqual(expect.objectContaining({ status: 415, message: 'Unsupported media type' }));
  });

  it('registers named SSE events, refreshes on them, and falls back to non-overlapping polling', async () => {
    vi.useFakeTimers(); const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock); const service = new ApiHomeShieldService('http://api');
    const started = service.start(); await vi.runAllTimersAsync(); await started;
    const source = FakeEventSource.instances[0]!;
    expect(source.listeners.has('case.created')).toBe(true); expect(source.listeners.has('plan.activated')).toBe(true);
    fetchMock.mockClear(); source.emit('case.created'); await vi.runAllTimersAsync();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/cases'))).toBe(true);
    fetchMock.mockClear(); source.onerror?.(); await vi.advanceTimersByTimeAsync(2000);
    expect(service.getConnection().status).toMatch(/reconnecting|connected/);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/cases'))).toHaveLength(1);
    service.stop();
  });
});
