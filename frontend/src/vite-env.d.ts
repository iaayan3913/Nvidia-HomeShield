/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `api` (default): FastAPI over HTTP + SSE. `local`: in-browser service for tests and offline work. */
  readonly VITE_DATA_MODE?: 'api' | 'local';
  /** Older name: `mock` is treated as VITE_DATA_MODE=local. */
  readonly VITE_DATA_SOURCE?: 'mock' | 'api';
}

/** Which application this bundle is: `resident`, `staff`, or `all` (combined dev/test build). */
declare const __APP_TARGET__: 'resident' | 'staff' | 'all';
