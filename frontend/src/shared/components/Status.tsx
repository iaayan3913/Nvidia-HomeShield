import type { CaseStatus, Severity } from '../types/domain';
import { homeShieldService, isApiMode, switchDataSource, useConnectionState } from '../data';

export function DemoIndicator() {
  const connection = useConnectionState();
  const label = !isApiMode ? 'Demo data' : connection.status === 'connected' ? 'Live API' : connection.status === 'connecting' || connection.status === 'reconnecting' ? 'API reconnecting' : 'API unavailable';
  return <span className="demo-indicator" title={connection.message}>
    <span aria-hidden="true" data-status={connection.status} />{label}
    {isApiMode && connection.status !== 'connected' ? <button type="button" onClick={() => void homeShieldService.retry()}>Retry</button> : null}
    {isApiMode ? <button type="button" onClick={() => switchDataSource('mock')}>Use demo</button> : null}
  </span>;
}
export function StatusBadge({ value }: { value: CaseStatus | Severity | 'pending' | 'approved' | 'rejected' }) {
  return <span className="status-badge" data-status={value}>{value.replaceAll('_', ' ')}</span>;
}
