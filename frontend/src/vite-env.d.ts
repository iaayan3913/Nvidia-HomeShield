/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `api` (default): FastAPI over HTTP + SSE. `local`: in-browser service for tests and offline work. */
  readonly VITE_DATA_MODE?: 'api' | 'local';
}

/** Which application this bundle is: `resident`, `staff`, or `all` (combined dev/test build). */
declare const __APP_TARGET__: 'resident' | 'staff' | 'all';
