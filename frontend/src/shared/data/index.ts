/**
 * Compatibility layer: the earlier `shared/data` API, now backed by the round-2 contract data service
 * (`shared/mock`: HTTP + SSE via the /api proxy, or the local service). New code should import from
 * `shared/mock` (`mockService`, `useDemoState`, `useConnection`) instead.
 */
import { useSyncExternalStore } from 'react';
import { connectionStore, DATA_MODE, switchDataSource, useConnection } from '../mock/connection';
import { mockService, startLiveData } from '../mock/service';
import { useTrackedCase } from '../mock/trackedCase';
import { useDemoState } from '../mock/useDemoState';
import type { Connection, ConnectionState, CreateReportInput, DataSourceMode, ReportMedia } from '../types/domain';

export const dataSourceMode: DataSourceMode = DATA_MODE === 'api' ? 'api' : 'mock';
export const isApiMode = DATA_MODE === 'api';
export { switchDataSource, useConnection, useDemoState, useTrackedCase };

let lastConnection: Connection | null = null; let lastState: ConnectionState | null = null;
/** Maps the contract connection onto the older status names; cached so React sees a stable snapshot. */
export function toConnectionState(connection: Connection): ConnectionState {
  if (connection === lastConnection && lastState) return lastState;
  const status: ConnectionState['status'] = connection.mode === 'local' ? 'demo' : connection.status === 'live' ? 'connected' : connection.status === 'connecting' ? 'connecting' : 'reconnecting';
  const message = status === 'demo' ? 'Local data on this device' : status === 'connected' ? 'Live updates connected' : status === 'connecting' ? 'Connecting to HomeShield' : 'Connection lost; retrying automatically';
  lastConnection = connection; lastState = { mode: dataSourceMode, status, message };
  return lastState;
}
const getConnection = () => toConnectionState(connectionStore.get());

export const homeShieldService = {
  getState: mockService.getState,
  subscribe: mockService.subscribe,
  start: async () => { startLiveData(); },
  stop: () => undefined, // the live connection is shared by the whole app and stays open
  retry: async () => { startLiveData(); },
  getConnection,
  subscribeConnection: connectionStore.subscribe,
  // Looked up at call time so wrappers (and test spies) on mockService are respected.
  createReport: (input: CreateReportInput, media?: ReportMedia) => mockService.createReport({
    ...input,
    photo: input.photo ?? media?.photos?.[0],
    audio: input.audio ?? media?.audio ?? undefined,
  }),
  findProperties: (query: string) => mockService.findProperties(query),
  generateScheduleProposal: (...args: Parameters<typeof mockService.generateScheduleProposal>) => mockService.generateScheduleProposal(...args),
  approveProposal: (...args: Parameters<typeof mockService.approveProposal>) => mockService.approveProposal(...args),
  rejectProposal: (...args: Parameters<typeof mockService.rejectProposal>) => mockService.rejectProposal(...args),
  simulateEmergency: () => mockService.simulateEmergency(),
  updateJobProgress: (...args: Parameters<typeof mockService.updateJobProgress>) => mockService.updateJobProgress(...args),
  recordActivity: (event: Parameters<typeof mockService.recordActivity>[0]) => { void mockService.recordActivity(event); },
  /** Throws synchronously when the server does not allow resets, matching the earlier behaviour. */
  reset: () => {
    if (!connectionStore.get().canReset) throw new Error('Reset is turned off on this server. Use local data to reset.');
    void mockService.reset();
  },
};

export const useHomeShieldState = useDemoState;
export const useConnectionState = () => useSyncExternalStore(connectionStore.subscribe, getConnection, getConnection);
export type * from '../types/domain';
