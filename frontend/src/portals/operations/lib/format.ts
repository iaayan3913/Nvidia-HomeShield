import type { CaseStatus, HazardType, JobStatus, Severity, Skill } from '../../../shared/types/domain';

export const HAZARD_LABEL: Record<HazardType, string> = {
  damp_mould: 'Damp and mould', leak: 'Leak', electrical: 'Electrical', gas: 'Gas', fire: 'Fire safety', other: 'Other repair',
};
export const SEVERITY_LABEL: Record<Severity, string> = { emergency: 'Emergency', significant: 'Significant', moderate: 'Moderate', routine: 'Routine' };
export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'New', investigating: 'Investigating', awaiting_approval: 'Awaiting approval', scheduled: 'Scheduled', in_progress: 'In progress', resolved: 'Resolved', escalated: 'Escalated',
};
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  unassigned: 'Unassigned', assigned: 'Assigned', travelling: 'Travelling', on_site: 'On site', completed: 'Completed', unable_to_complete: 'Unable to complete',
};
export const SKILL_LABEL: Record<Skill, string> = { general: 'General', damp_mould: 'Damp and mould', plumbing: 'Plumbing', electrical: 'Electrical', gas: 'Gas', fire: 'Fire safety' };

export const humanise = (value: string) => value.replaceAll(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const timeFormatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const dayFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const dayKey = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' });

const valid = (iso: string | null | undefined): iso is string => Boolean(iso) && !Number.isNaN(Date.parse(iso!));

/** "14:30", or "14 Nov 14:30" when not today. */
export function formatTime(iso: string | null | undefined, now = Date.now()): string {
  if (!valid(iso)) return '—';
  const date = new Date(iso);
  const sameDay = dayKey.format(date) === dayKey.format(new Date(now));
  return sameDay ? timeFormatter.format(date) : `${dayFormatter.format(date)} ${timeFormatter.format(date)}`;
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!valid(iso)) return '';
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  const abs = Math.abs(minutes);
  const amount = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  if (abs < 1) return 'now';
  return minutes > 0 ? `in ${amount}` : `${amount} ago`;
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]!.toUpperCase()).slice(0, 2).join('');

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
