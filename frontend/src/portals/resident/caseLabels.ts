import type { Case } from '../../shared/mock';
import type { VisitSummary } from './contract';

export const TRACK_STAGES = ['Received', 'Being reviewed', 'Visit scheduled', 'Operative on the way', 'On site', 'Completed'] as const;
export const UNABLE_LABEL = 'Unable to complete';

export interface TrackingStage { index: number; outcome: 'completed' | 'unable' | null; headline: string; detail: string }

/** Maps case and visit state to the resident-facing progress line. Shows only resident-safe information. */
export function trackingStage(item: Pick<Case, 'status'>, visit?: VisitSummary | null): TrackingStage {
  const who = visit?.operativeFirstName ? `${visit.operativeFirstName}, your operative,` : 'Your operative';
  if (item.status === 'resolved' || visit?.status === 'completed') return { index: 5, outcome: 'completed', headline: 'Repair completed', detail: 'The operative has marked the repair as complete. If the problem comes back, please report it again.' };
  if (visit?.status === 'unable_to_complete') return { index: 5, outcome: 'unable', headline: 'The repair could not be completed on this visit', detail: 'The housing team will contact you to arrange what happens next.' };
  if (visit?.status === 'on_site' || item.status === 'in_progress') return { index: 4, outcome: null, headline: 'Your operative is at your home', detail: 'Work is under way.' };
  if (visit?.status === 'travelling') return { index: 3, outcome: null, headline: 'Your operative is on the way', detail: `${who} is travelling to your home now.` };
  if (item.status === 'scheduled' || visit?.status === 'assigned') return { index: 2, outcome: null, headline: 'A repair visit has been scheduled', detail: 'The repairs team will contact you to confirm a time.' };
  if (item.status === 'new') return { index: 0, outcome: null, headline: 'We have received your report', detail: 'A housing officer will review it shortly.' };
  return { index: 1, outcome: null, headline: 'Your report is being reviewed', detail: 'A housing officer is checking your report and deciding the priority.' };
}

/** Whether automated triage suggests urgent human attention. Advisory only; an officer confirms. */
export const needsUrgentAttention = (item: Pick<Case, 'is_emergency' | 'severity'>) => item.is_emergency || item.severity === 'emergency' || item.severity === 'significant';

export const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
