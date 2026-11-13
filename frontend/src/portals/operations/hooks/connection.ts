import { useSyncExternalStore } from 'react';
import * as shared from '../../../shared/mock';

export interface ConnectionState {
  mode: 'api' | 'local';
  status: 'live' | 'connecting' | 'offline';
  simulatedServices: boolean;
  canReset: boolean;
  lastEventAt: string | null;
}

/**
 * CONTRACT-STANDIN for the shared `useConnection()` (round-2 contract). Uses the shared export when Platform has
 * merged it; otherwise reports the in-browser local mock honestly: local mode, simulated services, reset allowed.
 */
const sharedHook = (shared as unknown as { useConnection?: () => ConnectionState }).useConnection;
const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback); window.addEventListener('offline', callback);
  return () => { window.removeEventListener('online', callback); window.removeEventListener('offline', callback); };
};
const LOCAL_LIVE: ConnectionState = { mode: 'local', status: 'live', simulatedServices: true, canReset: true, lastEventAt: null };

function useLocalConnection(): ConnectionState {
  // The local mock syncs same-browser tabs only, so it is always "live" for this device.
  useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return LOCAL_LIVE;
}

export const useConnection: () => ConnectionState = sharedHook ?? useLocalConnection;
