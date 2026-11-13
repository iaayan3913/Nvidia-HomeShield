// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the `api` branch of the resident hook.
vi.mock('./connection', async (original) => ({ ...(await original<typeof import('./connection')>()), DATA_MODE: 'api' }));

class FakeEventSource {
  static urls: string[] = [];
  onopen = null; onerror = null; onmessage = null;
  constructor(url: string) { FakeEventSource.urls.push(url); }
  addEventListener() { /* no events needed */ }
  close() { /* noop */ }
}

afterEach(() => { vi.unstubAllGlobals(); FakeEventSource.urls = []; });

describe('useTrackedCase (resident scope)', () => {
  it('reads only the public view of one case and follows only its events', async () => {
    const calls: string[] = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/cases/case%201/public') return new Response(JSON.stringify({ id: 'case 1', hazard_type: 'leak', severity: 'moderate', is_emergency: false, status: 'scheduled', summary: 'Leak', room: null, deadlines: { verified: false, review_required: true, notes: [] }, property_id: 'p-1', created_at: '2026-11-13T10:00:00', updated_at: '2026-11-13T10:00:00' }));
      return new Response('{}', { status: 404 });
    }));
    const { useTrackedCase } = await import('./trackedCase');
    const { result } = renderHook(() => useTrackedCase('case 1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.case).toMatchObject({ id: 'case 1', status: 'scheduled', evidence: [], vulnerable_occupants: [] });
    expect(calls).toEqual(['/api/cases/case%201/public']);
    expect(FakeEventSource.urls).toEqual(['/api/stream?case_id=case%201&tail=true']);
  });

  it('reports not_found for an unknown reference and idle without one', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Case not found' }), { status: 404 })));
    const { useTrackedCase } = await import('./trackedCase');
    const { result } = renderHook(() => useTrackedCase('missing'));
    await waitFor(() => expect(result.current.status).toBe('not_found'));
    expect(renderHook(() => useTrackedCase(null)).result.current.status).toBe('idle');
  });
});
