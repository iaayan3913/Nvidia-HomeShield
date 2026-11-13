import type { CaseStatus, Severity } from '../types/domain';

export function DemoIndicator() { return <span className="demo-indicator" title="All information shown is fictional demonstration data"><span aria-hidden="true" />Demo data</span>; }
export function StatusBadge({ value }: { value: CaseStatus | Severity | 'pending' | 'approved' | 'rejected' }) {
  return <span className="status-badge" data-status={value}>{value.replaceAll('_', ' ')}</span>;
}
