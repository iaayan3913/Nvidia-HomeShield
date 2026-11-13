import { FlaskConical, Wifi, WifiOff } from 'lucide-react';
import { useConnection } from '../mock/connection';
import type { CaseStatus, Severity } from '../types/domain';

/** Shown only when the backend (or local mode) says automated services are simulated. */
export function TestModeIndicator() {
  const { simulatedServices } = useConnection();
  if (!simulatedServices) return null;
  return <span className="test-mode" title="Automated triage and scheduling are simulated in this environment">
    <FlaskConical size={14} aria-hidden="true" />Test mode<span className="visually-hidden">: automated triage and scheduling are simulated</span>
  </span>;
}
/** @deprecated Use TestModeIndicator; kept so older imports still compile. */
export const DemoIndicator = TestModeIndicator;

/** Live / reconnecting / offline, with text so state is not conveyed by colour alone. */
export function ConnectionIndicator() {
  const { status, mode } = useConnection();
  const label = mode === 'local' ? 'Offline mode' : status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline · retrying';
  return <span className="connection-indicator" data-status={mode === 'local' ? 'local' : status} role="status">
    {status === 'offline' ? <WifiOff size={14} aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />}{label}
  </span>;
}

export function StatusBadge({ value }: { value: CaseStatus | Severity | 'pending' | 'approved' | 'rejected' }) {
  return <span className="status-badge" data-status={value}>{value.replaceAll('_', ' ')}</span>;
}
