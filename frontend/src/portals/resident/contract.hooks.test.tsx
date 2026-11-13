// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  connection: { mode: 'api', status: 'connected', apiUrl: 'http://spark.test:8100' },
  retry: vi.fn(async () => undefined),
  state: {
    properties: [], activity: [{ created_at: '2026-11-13T15:01:00Z' }],
    cases: [{ id: 'case-live-123', hazard_type: 'damp_mould', hhsrs_category: null, severity: 'moderate',
      is_emergency: false, room: 'bedroom', vulnerable_occupants: [], summary: 'Backend mould case', evidence: [],
      deadlines: { verified: false, review_required: true, notes: [] }, status: 'awaiting_approval',
      property_id: 'p-001', created_at: '2026-11-13T15:00:00Z', updated_at: '2026-11-13T15:01:00Z', simulated: false }],
    jobs: [], assignments: [], workers: [],
  },
}));

vi.mock('../../shared/data', () => ({
  dataSourceMode: 'api',
  homeShieldService: { getState: () => shared.state, retry: shared.retry },
  useConnectionState: () => shared.connection,
  useHomeShieldState: (selector: (state: typeof shared.state) => unknown) => selector(shared.state),
}));

import { useConnection, useTrackedCase } from './contract';

describe('Resident live hooks', () => {
  beforeEach(() => { shared.connection.status = 'connected'; shared.retry.mockClear(); });

  it('reports API connectivity and tracks the actual backend case reference', async () => {
    const connection = renderHook(() => useConnection());
    expect(connection.result.current).toMatchObject({ mode: 'api', status: 'live', simulatedServices: false, canReset: false });
    expect(connection.result.current.lastEventAt).toBe('2026-11-13T15:01:00Z');

    const tracked = renderHook(() => useTrackedCase('CASE-LIVE-123'));
    await waitFor(() => expect(tracked.result.current.status).toBe('ready'));
    expect(tracked.result.current.case?.id).toBe('case-live-123');
    expect(tracked.result.current.case?.simulated).toBe(false);
    expect(shared.retry).toHaveBeenCalledTimes(1);
  });

  it('reports an API tracking error when the backend is unavailable', async () => {
    shared.connection.status = 'disconnected';
    const connection = renderHook(() => useConnection());
    expect(connection.result.current.status).toBe('offline');
    const tracked = renderHook(() => useTrackedCase('CASE-LIVE-123'));
    await waitFor(() => expect(tracked.result.current.status).toBe('error'));
  });
});
