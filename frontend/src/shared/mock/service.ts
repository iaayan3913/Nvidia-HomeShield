import type { MockService } from '../types/domain';
import { ApiDataService } from './api/apiService';
import { connectionStore, DATA_MODE } from './connection';
import { localService } from './localService';

/** The live adapter in `api` mode, otherwise null. */
export const apiService = DATA_MODE === 'api' ? new ApiDataService() : null;
/** Kept under its original name so portal imports do not change. */
export const mockService: MockService = apiService ?? localService;
/** Staff app only: load every case and follow the live stream. The resident app never calls this. */
export const startLiveData = () => apiService?.start();
/** Resident app: read `/api/health` only (for the Test mode badge). No case data is fetched. */
export const checkHealth = () => { void apiService?.health().then(() => connectionStore.set({ status: 'live' }), () => connectionStore.set({ status: 'offline' })); };
