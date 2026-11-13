// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('data source selection', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  const backendCase = { id: 'case-live-123', hazard_type: 'damp_mould', hhsrs_category: null,
    severity: 'moderate', is_emergency: false, room: 'bedroom', vulnerable_occupants: [],
    summary: 'Live backend case', evidence: [], deadlines: { verified: false, review_required: true, notes: [] },
    status: 'awaiting_approval', property_id: 'p-001', created_at: '2026-11-13T15:00:00Z' };

  function response(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  }

  function apiFetch(reportStatus = 201) {
    return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/sample-properties.json') return response([{ id: 'p-001', lat: 53.4, lon: -1.45, district: 'S4', area: 'Pitsmoor' }]);
      if (url.endsWith('/api/reports')) return reportStatus >= 400
        ? response({ detail: 'Backend rejected report' }, reportStatus)
        : response({ case: backendCase, plan: null, approval: null, warnings: [] }, reportStatus);
      if (url.endsWith('/api/cases')) return response([backendCase]);
      if (url.endsWith('/api/workers') || url.endsWith('/api/approvals') || url.includes('/api/events')) return response([]);
      if (url.includes('/api/plans/')) return response({ detail: 'none' }, 404);
      if (url.endsWith('/health')) return response({ status: 'ok' });
      throw new Error(`Unexpected request ${url}`);
    });
  }

  async function loadResidentContract(mode: 'mock' | 'api') {
    vi.stubEnv('VITE_DATA_SOURCE', mode); vi.resetModules();
    return import('../../portals/resident/contract');
  }

  const reportInput = { text: 'Mould in bedroom', category: 'damp_mould' as const, property_id: 'p-001',
    contact: { name: 'Resident', contact_number: '07000', preferred_contact: 'text' as const } };

  it('defaults to mock unless API mode is explicitly configured', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'mock'); vi.resetModules();
    expect((await import('./index')).dataSourceMode).toBe('mock');
  });

  it('honours an explicit runtime override without mixing modes', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'mock'); localStorage.setItem('homeshield.data-source.override', 'api'); vi.resetModules();
    const source = await import('./index');
    expect(source.dataSourceMode).toBe('api'); expect(source.isApiMode).toBe(true);
  });

  it('routes API-mode text reports to POST /api/reports and returns the backend case reference', async () => {
    const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock);
    const contract = await loadResidentContract('api');
    const result = await contract.submitReport(reportInput);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!;
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(call[1]?.body))).toEqual({ text: 'Mould in bedroom', property_id: 'p-001' });
    expect(result.case.id).toBe('case-live-123');
  });

  it('routes Resident photo and audio blobs through multipart FormData', async () => {
    const fetchMock = apiFetch(); vi.stubGlobal('fetch', fetchMock);
    const contract = await loadResidentContract('api');
    const photo = new File(['photo'], 'evidence.jpg', { type: 'image/jpeg' });
    const audio = new Blob(['voice'], { type: 'audio/webm' });
    await contract.submitReport({ ...reportInput, photo, audio });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/reports'))!;
    expect(call[1]?.body).toBeInstanceOf(FormData); expect(call[1]?.headers).toBeUndefined();
    const form = call[1]?.body as FormData;
    expect(form.get('photo')).toBe(photo); expect(form.get('audio')).toBeInstanceOf(Blob);
  });

  it('does not make backend requests in mock mode', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const contract = await loadResidentContract('mock');
    const result = await contract.submitReport(reportInput);
    expect(result.case.simulated).toBe(true); expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects backend errors without manufacturing a successful report', async () => {
    vi.stubGlobal('fetch', apiFetch(503));
    const contract = await loadResidentContract('api');
    await expect(contract.submitReport(reportInput)).rejects.toEqual(expect.objectContaining({ status: 503 }));
  });
});
