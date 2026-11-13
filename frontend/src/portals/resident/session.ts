import type { ReportDraft, StepIndex } from './model';
import { emptyDraft } from './model';

/**
 * In-memory session for the Resident portal. It survives moving between steps and between
 * portals inside this tab, and is discarded on reload. It holds structured text only —
 * never files, blobs or object URLs — and is never written to storage.
 */
interface ResidentSession { draft: ReportDraft; step: StepIndex; furthest: StepIndex; submittedRefs: string[] }

let session: ResidentSession = { draft: emptyDraft(), step: 0, furthest: 0, submittedRefs: [] };

export const readSession = (): ResidentSession => session;
export const writeSession = (patch: Partial<ResidentSession>) => { session = { ...session, ...patch }; };
export const rememberReference = (reference: string) => { session = { ...session, submittedRefs: [reference, ...session.submittedRefs.filter((item) => item !== reference)].slice(0, 5) }; };
export const resetDraft = () => { session = { ...session, draft: emptyDraft(), step: 0, furthest: 0 }; };
