/**
 * Round-2 shared-contract seam for the Resident app.
 *
 * Resident-specific compatibility helpers over the shared mock/API service.
 */
import { useCallback, useEffect, useState } from 'react';
import { dataSourceMode, homeShieldService, useConnectionState, useHomeShieldState } from '../../shared/data';
import type { Case, CreateReportInput, JobStatus, Property, Report, ReportResult } from '../../shared/types/domain';

// CONTRACT-STANDIN: the shared CreateReportInput gains these optional fields.
export type ResidentReportInput = Omit<CreateReportInput, 'property_id'> & {
  property_id?: string;
  photo?: Blob;
  audio?: Blob;
  address_line?: string;
  postcode?: string;
};

export interface ConnectionState { mode: 'api' | 'local'; status: 'live' | 'connecting' | 'offline'; simulatedServices: boolean; canReset: boolean; lastEventAt: string | null }

export function useConnection(): ConnectionState {
  const connection = useConnectionState();
  const lastEventAt = useHomeShieldState((state) => state.activity[0]?.created_at ?? null);
  const status = connection.status === 'connected' || connection.status === 'demo'
    ? 'live'
    : connection.status === 'disconnected' ? 'offline' : 'connecting';
  return { mode: dataSourceMode === 'api' ? 'api' : 'local', status,
    simulatedServices: dataSourceMode === 'mock', canReset: dataSourceMode === 'mock', lastEventAt };
}

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Searches the selected service's local synthetic property register by stable ID/address metadata. */
export async function findProperties(query: string): Promise<Property[]> {
  const needle = normalise(query);
  if (needle.length < 2) return [];
  const register = homeShieldService.getState().properties;
  return register.filter((item) => normalise(item.postcode).startsWith(needle) || normalise(item.display_address).includes(needle) || normalise(`${item.display_address}${item.postcode}`).includes(needle)).slice(0, 8);
}

export class SubmitTimeoutError extends Error { constructor() { super('The request timed out.'); this.name = 'SubmitTimeoutError'; } }
export const SUBMIT_TIMEOUT_MS = 30_000;

export type SubmittedServiceReport = ReportResult & { report?: Report };

function stablePropertyId(input: ResidentReportInput): string {
  if (input.property_id) return input.property_id;
  const properties = homeShieldService.getState().properties;
  if (!properties.length) throw new Error('No synthetic properties are available.');
  const key = normalise(`${input.postcode ?? ''}${input.address_line ?? ''}`);
  let hash = 0;
  for (const character of key) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return properties[hash % properties.length]!.id;
}

/** Sends through the selected shared service. A confirmation is returned only after that service resolves. */
export async function submitReport(input: ResidentReportInput): Promise<SubmittedServiceReport> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new SubmitTimeoutError()), SUBMIT_TIMEOUT_MS); });
  try {
    const { photo, audio, ...fields } = input;
    const serviceInput: CreateReportInput = { ...fields, property_id: stablePropertyId(input) };
    const call = homeShieldService.createReport(serviceInput, {
      photos: photo ? [photo] : [], audio: audio ?? null,
    });
    return await Promise.race([call, timeout]);
  } finally { window.clearTimeout(timer); }
}

export type TrackStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
/** Resident-safe visit progress. Not part of the contract yet; requested from Platform in the handoff. */
export interface VisitSummary { status: JobStatus; operativeFirstName: string | null }
export interface TrackedCase { case: Case | null; status: TrackStatus; retry(): void; visit?: VisitSummary | null }

export function useTrackedCase(reference: string | null): TrackedCase {
  const ref = reference?.trim().toUpperCase() || null;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const connection = useConnectionState();
  const found = useHomeShieldState((state) => (ref ? state.cases.find((item) => item.id.toUpperCase() === ref) ?? null : null));
  const job = useHomeShieldState((state) => (found ? state.jobs.find((item) => item.case_id === found.id) ?? null : null));
  const assignment = useHomeShieldState((state) => (job ? state.assignments.find((item) => item.active && item.job_id === job.id) ?? null : null));
  const operative = useHomeShieldState((state) => (assignment ? state.workers.find((item) => item.id === assignment.worker_id) ?? null : null));

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    setSettled(null);
    const token = `${ref}#${attempt}`;
    if (dataSourceMode === 'api') {
      void homeShieldService.retry().finally(() => { if (!cancelled) setSettled(token); });
      return () => { cancelled = true; };
    }
    const timer = window.setTimeout(() => setSettled(token), 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ref, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  if (!ref) return { case: null, status: 'idle', retry };
  if (settled !== `${ref}#${attempt}`) return { case: null, status: 'loading', retry };
  if (dataSourceMode === 'api' && connection.status === 'disconnected') return { case: null, status: 'error', retry };
  if (!found) return { case: null, status: 'not_found', retry };
  return { case: found, status: 'ready', retry, visit: job ? { status: job.status, operativeFirstName: operative?.name.split(' ')[0] ?? null } : null };
}
