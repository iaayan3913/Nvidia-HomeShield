import { useSyncExternalStore } from 'react';
import { mockService } from './mockService';
import type { DemoState } from '../types/domain';

export function useDemoState<T = DemoState>(selector: (state: DemoState) => T = (state) => state as T): T {
  const state = useSyncExternalStore(mockService.subscribe, mockService.getState, mockService.getState);
  return selector(state);
}
