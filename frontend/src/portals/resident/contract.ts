/** Resident-specific helpers over the shared live/local data service. */
import { useCallback, useEffect, useState } from 'react';
import {
  dataSourceMode,
  homeShieldService,
  useConnection as useSharedConnection,
  useDemoState,
  useTrackedCase as useSharedTrackedCase,
} from '../../shared/data';
import type { Case, Connection, CreateReportInput, JobStatus, Property, Report } from '../../shared/types/domain';

export type ResidentReportInput = CreateReportInput;
export type ConnectionState = Connection;

/** Live health/SSE state in API mode; deterministic local state in demo mode. */
export const useConnection = (): ConnectionState => useSharedConnection();

/** Uses the selected service. API mode searches the backend property register. */
export async function findProperties(query: string): Promise<Property[]> {
  if (query.trim().replace(/\s/g, '').length < 2) return [];
  return homeShieldService.findProperties(query);
}

export class SubmitTimeoutError extends Error {
  constructor() { super('The request timed out.'); this.name = 'SubmitTimeoutError'; }
}
export const SUBMIT_TIMEOUT_MS = 30_000;
export type SubmittedServiceReport = { report: Report; case: Case; warnings: string[] };

/** Sends through the selected service and never resolves until that service confirms success. */
export async function submitReport(input: ResidentReportInput): Promise<SubmittedServiceReport> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new SubmitTimeoutError()), SUBMIT_TIMEOUT_MS);
  });
  try {
    const call = homeShieldService.createReport(input, {
      photos: input.photo ? [input.photo] : [],
      audio: input.audio,
    });
    const result = await Promise.race([call, timeout]);
    return Object.assign(result, { warnings: result.warnings ?? [] });
  } finally {
    window.clearTimeout(timer);
  }
}

export type TrackStatus = 'idle' | 'loading' | 'ready' | 'not_found' | 'error';
export interface VisitSummary { status: JobStatus; operativeFirstName: string | null }
export interface TrackedCase { case: Case | null; status: TrackStatus; retry(): void; visit?: VisitSummary | null }

/** API mode uses the resident-safe public case endpoint and case-scoped SSE stream. */
export function useTrackedCase(reference: string | null): TrackedCase {
  const ref = reference?.trim().toUpperCase() || null;
  const tracked = useSharedTrackedCase(ref);
  const [localAttempt, setLocalAttempt] = useState(0);
  const [localSettled, setLocalSettled] = useState<string | null>(null);
  const job = useDemoState((state) => tracked.case
    ? state.jobs.find((item) => item.case_id === tracked.case!.id) ?? null : null);
  const assignment = useDemoState((state) => job
    ? state.assignments.find((item) => item.active && item.job_id === job.id) ?? null : null);
  const operative = useDemoState((state) => assignment
    ? state.workers.find((item) => item.id === assignment.worker_id) ?? null : null);

  useEffect(() => {
    if (dataSourceMode !== 'mock' || !ref) return;
    setLocalSettled(null);
    const token = `${ref}#${localAttempt}`;
    const timer = window.setTimeout(() => setLocalSettled(token), 250);
    return () => window.clearTimeout(timer);
  }, [ref, localAttempt]);

  const retry = useCallback(() => {
    setLocalAttempt((value) => value + 1);
    tracked.retry();
  }, [tracked.retry]);

  if (dataSourceMode === 'mock' && ref && localSettled !== `${ref}#${localAttempt}`) {
    return { case: null, status: 'loading', retry };
  }
  return {
    ...tracked,
    retry,
    visit: job ? { status: job.status, operativeFirstName: operative?.name.split(' ')[0] ?? null } : null,
  };
}
