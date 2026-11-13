import { useCallback, useEffect, useState } from 'react';
import type { Case, TrackedCase } from '../types/domain';
import { EVENT_TYPES } from './api/events';
import { ApiError, request } from './api/http';
import { mapCase, type BackendCase } from './api/mapping';
import { openStream } from './api/stream';
import { DATA_MODE } from './connection';
import { useDemoState } from './useDemoState';

type PublicCase = Pick<BackendCase, 'id' | 'hazard_type' | 'severity' | 'is_emergency' | 'status' | 'summary' | 'room' | 'deadlines' | 'property_id' | 'created_at' | 'updated_at'>;
/** The resident-safe view omits evidence, occupants and classification internals. */
export const mapPublicCase = (item: PublicCase): Case => mapCase({ ...item, hhsrs_category: null, vulnerable_occupants: [], evidence: [] }, false);

/**
 * One resident's case, kept live. In `api` mode it reads only `/api/cases/{ref}/public` and follows
 * only that case's SSE events, so the resident app never downloads other residents' data.
 */
export function useTrackedCase(reference: string | null): TrackedCase {
  const [result, setResult] = useState<Omit<TrackedCase, 'retry'>>({ case: null, status: reference ? 'loading' : 'idle' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const localCase = useDemoState((state) => DATA_MODE === 'local' && reference ? state.cases.find((c) => c.id === reference) ?? null : null);

  useEffect(() => {
    if (DATA_MODE === 'local' || !reference) { setResult({ case: null, status: 'idle' }); return; }
    let cancelled = false;
    const path = encodeURIComponent(reference);
    setResult({ case: null, status: 'loading' });
    const load = async () => {
      try { const found = mapPublicCase(await request<PublicCase>(`/cases/${path}/public`)); if (!cancelled) setResult({ case: found, status: 'ready' }); }
      catch (error) { if (!cancelled) setResult((current) => ({ case: current.case, status: error instanceof ApiError && error.status === 404 ? 'not_found' : current.case ? 'ready' : 'error' })); }
    };
    void load();
    const stream = openStream({
      url: (after) => `/api/stream?case_id=${path}&${after ? `after=${after}` : 'tail=true'}`, types: EVENT_TYPES,
      onEvent: () => void load(), onReconnect: () => void load(), onStatus: () => undefined,
    });
    return () => { cancelled = true; stream.close(); };
  }, [reference, attempt]);

  if (DATA_MODE === 'local') return { case: localCase, status: !reference ? 'idle' : localCase ? 'ready' : 'not_found', retry };
  return { ...result, retry };
}
