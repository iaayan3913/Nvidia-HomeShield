import { useSyncExternalStore } from 'react';
import type { Connection } from '../types/domain';

/** `local` in tests or with VITE_DATA_MODE=local; otherwise `api` (HTTP + SSE to FastAPI). */
export const DATA_MODE: Connection['mode'] = import.meta.env.VITE_DATA_MODE === 'local' || import.meta.env.MODE === 'test' ? 'local' : 'api';

const LOCAL: Connection = { mode: 'local', status: 'live', simulatedServices: true, canReset: true, lastEventAt: null };
const API: Connection = { mode: 'api', status: 'connecting', simulatedServices: false, canReset: false, lastEventAt: null };

let current: Connection = DATA_MODE === 'local' ? LOCAL : API;
const listeners = new Set<() => void>();

export const connectionStore = {
  get: () => current,
  set(patch: Partial<Connection>) {
    const next = { ...current, ...patch };
    if ((Object.keys(next) as Array<keyof Connection>).every((key) => next[key] === current[key])) return;
    current = next; listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

/** Live connection and honesty state for headers, indicators and reset controls. */
export const useConnection = (): Connection => useSyncExternalStore(connectionStore.subscribe, connectionStore.get, connectionStore.get);
