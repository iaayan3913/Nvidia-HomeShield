/**
 * Round-2 shared-contract seam for the Resident app.
 *
 * Everything marked CONTRACT-STANDIN mirrors a signature from `frontend/tasks/v2-00-shared-contract.md`
 * that Platform has not merged yet. After Platform merges, the integrator should:
 *   - import `useConnection` and `useTrackedCase` from shared code instead of this file;
 *   - delete the local fallbacks in `findProperties` and `submitReport` (call `mockService` directly);
 *   - delete `ResidentReportInput` in favour of the extended shared `CreateReportInput`.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { mockService, useDemoState, type Case, type CreateReportInput, type JobStatus, type Property, type Report } from '../../shared/mock';

// CONTRACT-STANDIN: the shared CreateReportInput gains these optional fields.
export type ResidentReportInput = Omit<CreateReportInput, 'property_id'> & {
  property_id?: string;
  photo?: Blob;
  audio?: Blob;
  address_line?: string;
  postcode?: string;
};

export interface ConnectionState { mode: 'api' | 'local'; status: 'live' | 'connecting' | 'offline'; simulatedServices: boolean; canReset: boolean; lastEventAt: string | null }

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify); window.addEventListener('offline', notify);
  return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify); };
};

// CONTRACT-STANDIN: replace with the shared useConnection().
export function useConnection(): ConnectionState {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return { mode: 'local', status: online ? 'live' : 'offline', simulatedServices: true, canReset: true, lastEventAt: null };
}

type ServiceWithContract = typeof mockService & {
  findProperties?: (query: string) => Promise<Property[]> | Property[];
};

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Searches the property register by postcode or address text. Uses the shared method once Platform provides it. */
export async function findProperties(query: string): Promise<Property[]> {
  const service = mockService as ServiceWithContract;
  if (typeof service.findProperties === 'function') return await service.findProperties(query);
  // CONTRACT-STANDIN: local filter until mockService.findProperties exists.
  const needle = normalise(query);
  if (needle.length < 2) return [];
  const register = await Promise.resolve(mockService.getProperties());
  return register.filter((item) => normalise(item.postcode).startsWith(needle) || normalise(item.display_address).includes(needle) || normalise(`${item.display_address}${item.postcode}`).includes(needle)).slice(0, 8);
}

export class SubmitTimeoutError extends Error { constructor() { super('The request timed out.'); this.name = 'SubmitTimeoutError'; } }
export const SUBMIT_TIMEOUT_MS = 30_000;

/** Sends a report. Rejects on failure or timeout; callers must not show a confirmation unless this resolves. */
export async function submitReport(input: ResidentReportInput): Promise<{ report: Report; case: Case }> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new SubmitTimeoutError()), SUBMIT_TIMEOUT_MS); });
  try {
    // The extended input is what the api adapter accepts; the current local mock ignores the Blobs and address fields.
    const call = Promise.resolve().then(() => mockService.createReport(input as CreateReportInput));
    return await Promise.race([call, timeout]);
  } finally { window.clearTimeout(timer); }
}

export type TrackStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
/** Resident-safe visit progress. Not part of the contract yet; requested from Platform in the handoff. */
export interface VisitSummary { status: JobStatus; operativeFirstName: string | null }
export interface TrackedCase { case: Case | null; status: TrackStatus; retry(): void; visit?: VisitSummary | null }

// CONTRACT-STANDIN: replace with the shared useTrackedCase(reference). Resolves one case only.
export function useTrackedCase(reference: string | null): TrackedCase {
  const ref = reference?.trim().toUpperCase() || null;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const found = useDemoState((state) => (ref ? state.cases.find((item) => item.id.toUpperCase() === ref) ?? null : null));
  const job = useDemoState((state) => (found ? state.jobs.find((item) => item.case_id === found.id) ?? null : null));
  const assignment = useDemoState((state) => (job ? state.assignments.find((item) => item.active && item.job_id === job.id) ?? null : null));
  const operative = useDemoState((state) => (assignment ? state.workers.find((item) => item.id === assignment.worker_id) ?? null : null));

  // Simulate the network round-trip so the loading state is exercised.
  useEffect(() => {
    if (!ref) return;
    setSettled(null);
    const timer = window.setTimeout(() => setSettled(`${ref}#${attempt}`), 250);
    return () => window.clearTimeout(timer);
  }, [ref, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  if (!ref) return { case: null, status: 'idle', retry };
  if (settled !== `${ref}#${attempt}`) return { case: null, status: 'loading', retry };
  if (!found) return { case: null, status: 'not_found', retry };
  return { case: found, status: 'ready', retry, visit: job ? { status: job.status, operativeFirstName: operative?.name.split(' ')[0] ?? null } : null };
}
