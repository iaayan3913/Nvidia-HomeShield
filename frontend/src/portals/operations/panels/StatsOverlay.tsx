import { memo } from 'react';
import { ListChecks, RotateCcw, Siren } from 'lucide-react';
import { DUE_SOON_HOURS, type OpsSummary } from '../lib/derive';
import type { ConnectionState } from '../hooks/connection';

interface Props {
  summary: OpsSummary;
  connection: ConnectionState;
  scheduleOpen: boolean;
  pendingCount: number;
  onToggleSchedule(): void;
  emergencyExists: boolean;
  onEmergency(): void;
  onReset(): void;
}

const LIVE_TEXT: Record<ConnectionState['status'], string> = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };

/** Floating stats and actions over the map; replaces the KPI strip. */
export const StatsOverlay = memo(function StatsOverlay({ summary, connection, scheduleOpen, pendingCount, onToggleSchedule, emergencyExists, onEmergency, onReset }: Props) {
  const status = connection.mode === 'local' && connection.status === 'live' ? 'local' : connection.status;
  const label = status === 'local' ? 'Local data' : LIVE_TEXT[connection.status];
  return <div className="ops-stats" role="region" aria-label="Operational summary">
    <span className="ops-live" data-status={status} title={connection.lastEventAt ? `Last update ${new Date(connection.lastEventAt).toLocaleTimeString('en-GB')}` : undefined}>
      <span className="ops-live__dot" aria-hidden="true" />{label}
    </span>
    {connection.simulatedServices ? <span className="ops-test-mode" title="Automated triage and scheduling are simulated in this environment.">Test mode</span> : null}
    <dl className="ops-stats__list">
      <div><dt>Open cases</dt><dd>{summary.openCases}</dd></div>
      <div data-alert={summary.emergencies > 0 || undefined}><dt>Emergencies</dt><dd>{summary.emergencies > 0 ? <Siren size={14} aria-hidden="true" /> : null}{summary.emergencies}</dd></div>
      <div><dt>Due ≤ {DUE_SOON_HOURS} h</dt><dd>{summary.jobsDueSoon}</dd></div>
      <div><dt>Operatives free</dt><dd>{summary.availableOperatives}<span className="ops-muted">/{summary.totalOperatives}</span></dd></div>
    </dl>
    <div className="ops-stats__actions">
      <button type="button" className="ops-tool-button" aria-pressed={scheduleOpen} onClick={onToggleSchedule}>
        <ListChecks size={17} aria-hidden="true" /><span>Schedule</span>{pendingCount ? <span className="ops-pill" aria-label={`${pendingCount} awaiting approval`}>{pendingCount}</span> : null}
      </button>
      {connection.simulatedServices || emergencyExists ? <button type="button" className={`button ${emergencyExists ? 'button--secondary' : 'button--danger'} ops-emergency-button`} onClick={onEmergency}>
        <Siren size={17} aria-hidden="true" /><span>{emergencyExists ? 'Review emergency' : 'Simulate emergency'}</span>
      </button> : null}
      {connection.canReset ? <button type="button" className="ops-tool-button" onClick={onReset} aria-label="Reset test data" title="Reset test data"><RotateCcw size={17} aria-hidden="true" /></button> : null}
    </div>
  </div>;
});
