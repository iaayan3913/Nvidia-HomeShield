import { FlaskConical } from 'lucide-react';
import { useConnection } from '../contract';

/** Shown only when the backend reports simulated services. Swap for the shared indicator if Platform provides one. */
export function TestModeBadge() {
  const { simulatedServices } = useConnection();
  if (!simulatedServices) return null;
  return <p className="rp-test-mode"><FlaskConical size={16} aria-hidden="true" /><span><strong>Test mode.</strong> Automated triage and scheduling are simulated.</span></p>;
}

export function OfflineNotice() {
  const { status } = useConnection();
  if (status !== 'offline') return null;
  return <p className="rp-offline" role="status">You are offline. You can keep filling in your report; it will be saved on this device until you can send it.</p>;
}
