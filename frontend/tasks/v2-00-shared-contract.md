# Round 2 shared contract

This contract binds all three round-2 tasks: `v2-01-resident.md`, `v2-02-operations.md` and `v2-03-operative-platform.md`. Read it before starting. If you need it changed, request the change in your handoff; do not change it unilaterally.

## Product shape

HomeShield is a real repair-reporting service, built as two web applications backed by one FastAPI service.

- **Resident app**: tenants report problems and track them on a phone, tablet or laptop. It serves the resident routes (`/report`, `/report?view=track&ref=…`). It has no links to the staff dashboards.
- **Staff app**: housing officers (`/operations`) and operatives (`/operative`) use it on a laptop or PC.
- **Backend**: `backend.app:app` (FastAPI, SQLite, SSE at `/api/stream`) is the single source of truth. A report submitted on a phone must appear in Operations on a different laptop within about 2 seconds, through SSE, without a reload.

Two-device topology (same Wi-Fi network). The Platform agent defines and documents the exact commands.

- **Laptop**: runs the backend (bound to `0.0.0.0:8001`), the staff app (port 5174) and the resident app dev server (port 5173, exposed on the LAN).
- **Phone**: opens the resident app at `https://<laptop-LAN-IP>:5173`.
- **API calls**: the frontend calls relative `/api/...` URLs. Each Vite dev server proxies `/api` (including the SSE stream) to the backend, so the phone only ever talks to the resident app's own origin. No mixed content, no CORS and no hard-coded IP addresses.
- **Microphone recording on phones** needs HTTPS (a secure context). Plain `http://<LAN-IP>` cannot record voice notes; photos and text still work.

## Theme

- `<html data-theme="light" | "dark">` is always set before first paint by an inline script in every HTML entry. The preference is stored in `localStorage['homeshield.theme']` as `light`, `dark` or `system` (default `system`, which follows `prefers-color-scheme`).
- Global semantic token names in `src/styles/global.css` keep their current names: `--surface`, `--surface-subtle`, `--surface-muted`, `--border`, `--border-strong`, `--ink-900`, `--ink-700`, `--ink-500`, `--green-050/500/600/700`, `--danger`, `--danger-soft`, `--danger-dark`, `--warning`, `--warning-soft`, `--info`, `--info-soft`, `--success`, `--success-soft`. Only their values change per theme. `--graphite-*` are fixed palette values, not theme surfaces. Portals must use semantic tokens for surfaces and text.
- No portal is forced into one theme. The `[data-portal="operations"]` forced-dark override is removed by Platform.
- Each app header has a theme control (Platform). Portals react to theme changes by observing the `data-theme` attribute on `document.documentElement` (MutationObserver), or through the shared `useTheme()` hook once it is merged.
- Portal TypeScript and CSS contain no hex/rgb colour literals. Derive colours with `var()` and `color-mix()`. Portal-specific tokens (for example map colours) may be defined in the portal's own stylesheet under `[data-theme="light"]` / `[data-theme="dark"]` selectors.

## Data service

- Portals keep importing `import { mockService, useDemoState } from '../../shared/mock';`. Platform makes `mockService` the active adapter: `api` (HTTP + SSE to FastAPI, the default) or `local` (the existing in-browser mock, selected with `VITE_DATA_MODE=local`, used for tests and offline development).
- Every `mockService` method may return a Promise. Portals must `await` every call, disable the triggering control while it is pending, show a readable error with a retry on failure, and never assume success. Awaiting the current synchronous mock is valid TypeScript, so make this change now.
- `useDemoState(selector)` stays a synchronous snapshot with the current `DemoState` field names, kept live by SSE in `api` mode.
- `CreateReportInput` gains optional `photo?: Blob` and `audio?: Blob` (at most one of each, matching the backend multipart contract), plus optional structured address fields `address_line?: string` and `postcode?: string` for homes not found in the property register.
- New shared exports (Platform implements them). Until they exist in your checkout, put a stand-in with the same signature inside your own directory, marked `// CONTRACT-STANDIN`, so the integrator can delete it after merging:
  - `useConnection(): { mode: 'api' | 'local'; status: 'live' | 'connecting' | 'offline'; simulatedServices: boolean; canReset: boolean; lastEventAt: string | null }`. `simulatedServices` is true when `/health` reports `mocks: true`, or in `local` mode. `canReset` is true only in `local` mode, or when the backend enables its development reset endpoint.
  - `mockService.findProperties(query: string): Promise<Property[]>` searches the property register by postcode or address text.
  - `useTrackedCase(reference: string | null): { case: Case | null; status: 'idle' | 'loading' | 'ready' | 'not_found' | 'error'; retry(): void }`. Resident-scoped and live-updating. The resident app must never download every case.

## Product language

- This is a real service. Remove "fictional", "demonstration", "demo data" and blanket "simulated" wording from product chrome and copy.
- Honesty is driven by the backend's actual state, not hard-coded. When `useConnection().simulatedServices` is true, show one small, consistent "Test mode" indicator explaining that automated triage and scheduling are simulated. Never claim a service or dataset is real when it is not. If a dataset is sample data, its attribution says so.
- Automated classification and deadlines remain advisory ("Suggested by automated triage; a housing officer confirms"). Never promise statutory deadlines. Keep the safety advice: 999 for immediate danger, and 0800 111 999 for the National Gas Emergency Service.
- Never log resident personal data to the console, analytics or SSE payloads.

## Ownership

| Agent | Writable |
|---|---|
| Resident | `frontend/src/portals/resident/**` |
| Operations | `frontend/src/portals/operations/**`, `scripts/fetch-sheffield.py`, `frontend/public/data/**` |
| Operative + Platform | `frontend/src/portals/operative/**`, `frontend/src/app/**`, `frontend/src/shared/**`, `frontend/src/styles/**`, `frontend/*.html`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `backend/**` (additive changes only), `.env.example`, `README.md` run section, `.gitignore` |

Everything else is read-only. If you need a change outside your area, write the exact request in your handoff. Each agent creates one branch from the latest `main`: `frontend-v2/resident`, `frontend-v2/operations` or `frontend-v2/platform`. Do not merge `main` or other branches into it. The preferred merge order is Platform first, then Resident and Operations, which then delete their `CONTRACT-STANDIN` code.

## Definition of done (every agent)

- From `frontend/`, run `npm run typecheck`, `npm test` and `npm run build`. Run any backend tests you touched from the repository root.
- Check light and dark themes in a real browser at the viewports listed in your prompt. The browser console must have no errors.
- Report only tests you actually performed. Name what is untested (for example "two physical devices not tested").
- Handoff: files changed, features, exact tests and viewports, screenshots, accessibility checks, limitations, requested shared changes and the final commit hash.
