import { describe, expect, it } from 'vitest';
import { dataSourceMode, homeShieldService, toConnectionState } from './index';

describe('shared/data compatibility layer', () => {
  it('uses the local service in tests and maps connection states', () => {
    expect(dataSourceMode).toBe('mock');
    expect(toConnectionState({ mode: 'local', status: 'live', simulatedServices: true, canReset: true, lastEventAt: null }).status).toBe('demo');
    expect(toConnectionState({ mode: 'api', status: 'live', simulatedServices: false, canReset: false, lastEventAt: null }).status).toBe('connected');
    expect(toConnectionState({ mode: 'api', status: 'offline', simulatedServices: false, canReset: false, lastEventAt: null }).status).toBe('reconnecting');
  });

  it('delegates actions to the contract service', async () => {
    homeShieldService.reset();
    const { proposal } = await homeShieldService.simulateEmergency();
    expect(homeShieldService.getState().proposals.map((p) => p.id)).toContain(proposal.id);
  });
});
