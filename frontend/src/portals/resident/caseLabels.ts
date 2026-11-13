import type { Case, CaseStatus, JobStatus } from '../../shared/mock';

export const RESIDENT_STATUS: Record<CaseStatus, string> = {
  new: 'Received',
  awaiting_approval: 'Waiting for a housing officer to review',
  investigating: 'Being looked into',
  escalated: 'Escalated for urgent review',
  scheduled: 'Repair visit planned',
  in_progress: 'Work under way',
  resolved: 'Repair completed',
};

export const JOB_STATUS: Record<JobStatus, string> = {
  unassigned: 'No operative assigned yet',
  assigned: 'An operative has been assigned',
  travelling: 'The operative is on the way',
  on_site: 'The operative is at the property',
  completed: 'The operative has marked the job complete',
  unable_to_complete: 'The operative could not complete the job; the team will be in touch',
};

export const TIMELINE = ['Received', 'Reviewed', 'Visit planned', 'Work under way', 'Completed'] as const;

export function timelineIndex(status: CaseStatus): number {
  switch (status) {
    case 'new': case 'awaiting_approval': return 0;
    case 'investigating': case 'escalated': return 1;
    case 'scheduled': return 2;
    case 'in_progress': return 3;
    case 'resolved': return 4;
  }
}

/** Whether the simulated classification asks for urgent human attention. Never an official determination. */
export const needsUrgentAttention = (item: Pick<Case, 'is_emergency' | 'severity'>) => item.is_emergency || item.severity === 'emergency' || item.severity === 'significant';

export const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
