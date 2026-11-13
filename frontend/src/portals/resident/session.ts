import { emptyDraft, LAST_STEP, type ReportDraft, type StepIndex } from './model';

/**
 * Tab-scoped session for the Resident app, kept in sessionStorage so an unsent draft survives a
 * failed submission, a reload or moving between screens. It holds structured text only: photos,
 * recordings and object URLs are never written here.
 */
interface ResidentSession { draft: ReportDraft; step: StepIndex; furthest: StepIndex; submittedRefs: string[] }

const KEY = 'homeshield.resident.session.v2';
const fresh = (): ResidentSession => ({ draft: emptyDraft(), step: 0, furthest: 0, submittedRefs: [] });
let memory: ResidentSession | null = null;

const storage = () => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };
const clampStep = (value: unknown): StepIndex => (typeof value === 'number' && value >= 0 && value <= LAST_STEP ? Math.floor(value) as StepIndex : 0);

export function readSession(): ResidentSession {
  if (memory) return memory;
  const fallback = fresh();
  try {
    const parsed = JSON.parse(storage()?.getItem(KEY) ?? 'null') as Partial<ResidentSession> | null;
    memory = parsed ? {
      draft: { ...fallback.draft, ...(parsed.draft ?? {}) },
      step: clampStep(parsed.step), furthest: clampStep(parsed.furthest),
      submittedRefs: Array.isArray(parsed.submittedRefs) ? parsed.submittedRefs.filter((ref): ref is string => typeof ref === 'string').slice(0, 5) : [],
    } : fallback;
  } catch { memory = fallback; }
  return memory;
}

function persist(next: ResidentSession) {
  memory = next;
  try { storage()?.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked: memory copy still works */ }
}

export const writeSession = (patch: Partial<ResidentSession>) => persist({ ...readSession(), ...patch });
export const rememberReference = (reference: string) => { const current = readSession(); persist({ ...current, submittedRefs: [reference, ...current.submittedRefs.filter((item) => item !== reference)].slice(0, 5) }); };
export const resetDraft = () => persist({ ...readSession(), draft: emptyDraft(), step: 0, furthest: 0 });
/** Test helper: forget everything, including remembered references. */
export const clearSession = () => { memory = null; try { storage()?.removeItem(KEY); } catch { /* ignore */ } };
