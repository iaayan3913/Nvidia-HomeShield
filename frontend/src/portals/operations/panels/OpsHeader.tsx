import { memo } from 'react';
import { History, ListChecks, PanelLeft, RotateCcw, Siren, WifiOff } from 'lucide-react';
import type { OpsSummary } from '../lib/derive';
import { DUE_SOON_HOURS } from '../lib/derive';

interface Props {
  summary: OpsSummary;
  online: boolean;
  railOpen: boolean;
  onToggleRail(): void;
  drawerTab: 'schedule' | 'activity' | null;
  onOpenDrawer(tab: 'schedule' | 'activity'): void;
  pendingCount: number;
  emergencyExists: boolean;
  onEmergency(): void;
  onReset(): void;
}

export const OpsHeader = memo(function OpsHeader({ summary, online, railOpen, onToggleRail, drawerTab, onOpenDrawer, pendingCount, emergencyExists, onEmergency, onReset }: Props) {
  return <header className="ops-header">
    <div className="ops-header__title">
      <h1>Sheffield operations</h1>
      <p>Digital twin · fictional demonstration data{!online ? <span className="ops-offline"><WifiOff size={14} aria-hidden="true" />Offline, using local map files</span> : null}</p>
    </div>
    <dl className="ops-summary-strip" aria-label="Operational summary">
      <div><dt>Open cases</dt><dd>{summary.openCases}</dd></div>
      <div data-alert={summary.emergencies > 0 || undefined}><dt>Emergencies</dt><dd>{summary.emergencies > 0 ? <Siren size={15} aria-hidden="true" /> : null}{summary.emergencies}</dd></div>
      <div><dt>Jobs due ≤ {DUE_SOON_HOURS} h</dt><dd>{summary.jobsDueSoon}</dd></div>
      <div><dt>Operatives free</dt><dd>{summary.availableOperatives}<span className="ops-muted">/{summary.totalOperatives}</span></dd></div>
    </dl>
    <div className="ops-header__actions">
      <button type="button" className="ops-tool-button ops-only-compact" aria-pressed={railOpen} onClick={onToggleRail}><PanelLeft size={17} aria-hidden="true" /><span>Cases</span></button>
      <button type="button" className="ops-tool-button" aria-pressed={drawerTab === 'schedule'} onClick={() => onOpenDrawer('schedule')}>
        <ListChecks size={17} aria-hidden="true" /><span>Schedule</span>{pendingCount ? <span className="ops-pill" aria-label={`${pendingCount} awaiting approval`}>{pendingCount}</span> : null}
      </button>
      <button type="button" className="ops-tool-button" aria-pressed={drawerTab === 'activity'} onClick={() => onOpenDrawer('activity')}><History size={17} aria-hidden="true" /><span>Activity</span></button>
      <button type="button" className={`button ${emergencyExists ? 'button--secondary' : 'button--danger'} ops-emergency-button`} onClick={onEmergency}>
        <Siren size={17} aria-hidden="true" /><span>{emergencyExists ? 'Review emergency' : 'Simulate emergency'}</span>
      </button>
      <button type="button" className="ops-tool-button" onClick={onReset}><RotateCcw size={17} aria-hidden="true" /><span>Reset demo</span></button>
    </div>
  </header>;
});
