# Round 2 handoff · Platform + Operative (`frontend-v2/platform`)

Task: `frontend/tasks/v2-03-operative-platform.md`, implementing most of `v2-00-shared-contract.md`. Merge this branch **first**; Resident and Operations then delete their `CONTRACT-STANDIN` code (see the last section).

## What changed

**Two apps** (`src/app/resident/ResidentApp.tsx`, `src/app/staff/StaffApp.tsx`, `src/main.tsx`, `vite.config.ts`, `index.html`, `package.json`)
- A build-time `__APP_TARGET__` (Vite mode `resident` / `staff`) picks the app, and the bundler drops the other branches. The staff portals are lazy routes.
- Scripts: `dev:resident` (5173, LAN), `dev:resident:https` (adds `@vitejs/plugin-basic-ssl`), `dev:staff` (5174, localhost), `build:resident`, `build:staff`. `build` runs `tsc -b` and then both builds. `dev` is the combined app (all routes), and tests use it too.
- Both dev servers proxy `/api` (SSE included) to `VITE_BACKEND_URL` (default `http://127.0.0.1:8001`).

**Theme** (`src/shared/theme/`, `src/styles/global.css`)
- `applyStoredTheme()` is inlined into `<head>` by a Vite plugin, so `data-theme` and `<meta name="theme-color">` are set before first paint.
- `useTheme()` returns `{ theme, preference, setPreference }` and follows other tabs and system changes.
- `ThemeControl` is a native radio group (Light / Dark / System) and sits in both headers.
- Light and dark token sets keep every existing token name. The forced-dark `[data-portal="operations"]` override is removed (`data-portal` stays as a styling hook).
- Light values that failed AA were fixed: `--ink-500`, `--border-strong`, `--danger`, `--warning`. Added tokens: `--focus`, `--danger-solid`, `--topbar`.

**Live data service** (`src/shared/mock/`)
- `mockService` is now `ApiDataService` (`api`, the default) or `LocalMockService` (`VITE_DATA_MODE=local`, and always under Vitest). The import path is unchanged.
- Every action returns a Promise. `getState`, `subscribe` and the `get*` snapshot readers stay synchronous.
- `api/http.ts`: relative `/api` only, and typed `ApiError` with user-safe messages plus an HTTP `status` (0 means network).
- `api/mapping.ts`: the single schema-mapping module (differences listed below).
- `api/events.ts`: `reduceEvent`. Duplicate events are ignored and out-of-order events are placed by sequence. Plans, job status and case status are patched straight from the event payload. Everything else is refetched per resource (`cases`, `plans`, `approvals`, `jobs`, `all`), coalesced over 150 ms.
- `api/stream.ts`: `EventSource` with named events and exponential backoff (1 s, 2 s … 30 s). It resumes with `?after=<last sequence>` and refetches everything after a reconnect.
- `useConnection()`: `{ mode, status, simulatedServices, canReset, lastEventAt }`, driven by `/api/health` (`mocks`, `dev_reset`) and the stream.
- `findProperties(query)`, `useTrackedCase(ref)`, and the extended `CreateReportInput` (`photo`, `audio`, `address_line`, `postcode`, contact `email`).
- `createReport` sends multipart only when media is present and never sets `Content-Type` for it. Otherwise it sends JSON.
- Resident scope: nothing is fetched until `startLiveData()`, which only the staff app calls. The resident app calls `checkHealth()` (for the Test mode badge) and nothing else. `useTrackedCase` reads `/api/cases/{ref}/public` and `/api/stream?case_id={ref}&tail=true` only.
- Local service fixes: an approved re-plan keeps unrelated active assignments; progress transitions are validated; `evidence_count` is recorded; `findProperties` is added.

**Shared chrome**
- `PortalNav` takes `links`, `home` and `product`.
- `TestModeIndicator` only appears when `simulatedServices` is true. `DemoIndicator` remains as an alias.
- New `ConnectionIndicator` (Live / Connecting… / Offline · retrying, as text as well as colour).
- `ErrorBoundary` no longer uses "demonstration" wording.
- Toasts are themed because the tokens now live on `<html>`.

**Operative dashboard** (`src/portals/operative/`)
- Laptop-first layout: identity bar with a **Viewing as** selector, a sticky "Today's route" list, and the selected job's detail. It works down to 1024×768 and stacks on narrow screens.
- Every progress call is awaited, with a pending state ("Updating…" / "Saving…"), a readable error and a **Retry** button. There is an offline banner, and the header shows the connection state.
- Scheduler jobs that have no resident case are labelled "Planned … maintenance visit" with a "Planned maintenance" tag.
- Access notes come from `/api/jobs` (staff only).
- No "demonstration" or "fictional" wording. One attribution line says addresses come from a sample property register.

**Backend** (additive; `backend/records.py`, `backend/service.py`, `backend/app.py`, `backend/schemas.py`, `backend/config.py`)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Alias of `/health`, which also gains `dev_reset` |
| `GET /api/properties?q=&limit=` | Property register search: postcode district (first token), area text or ID |
| `GET /api/cases/{id}/public` | Resident-safe case view: no evidence references, occupants or HHSRS category |
| `GET /api/jobs` | Every known job with `status`, `property_id`, `source`, `hazard_type`, `severity`, `access_notes` and progress fields |
| `POST /api/jobs/{job_id}/progress` | `{status, notes?, evidence_count?}`. Transitions are validated (409). Notes are required for completed and unable to complete (422). The case moves to `in_progress` or `resolved`. Emits `job.progress` with IDs and status only. |
| `POST /api/dev/reset` | Returns 404 unless `ALLOW_DEV_RESET=true`. Deletes cases, plans, approvals, events and private records, then emits `system.reset`. |
| `GET /api/events?tail=N` | Newest N events |
| `GET /api/stream?after=&tail=&case_id=` | Resume point, no-replay start, and per-case filter. The stream now sends `: connected` immediately. Without it, the Vite proxy held the connection on "Connecting" for 15 s. |

- `ReportIn` gains optional `contact`, `address_line` and `postcode`. Multipart accepts `contact_name`, `contact_phone`, `contact_email`, `contact_preferred`, `access_notes`, `address_line` and `postcode`.
- These details are stored in `PrivateRecords` (separate tables), never in events, SSE, `/api/events`, `/api/cases` or logs.
- Completed jobs are excluded from future proposals.

**Docs**
- `README.md`: new section "Run HomeShield on two devices".
- `.env.example`: adds `ALLOW_DEV_RESET` and frontend variable guidance.

## Schema differences (backend → frontend)

| Model | Difference and handling |
|---|---|
| Case | `property_id` may be null and becomes `''`. No `report_id`. `simulated` comes from `/health.mocks`. Naive UTC timestamps get a `Z` suffix. |
| Worker | No `role` or `home_district`. Role is derived from skills ("Gas operative" / "Multi-skilled operative"); base is the district of the nearest register property. |
| Job | Not exposed before; now `/api/jobs`. Adds `source: 'case' \| 'planned'`, `hazard_type`, `severity` and `access_notes`. Nullable progress fields become optional. |
| Plan | `solver` is free text (type widened from `'mock-deterministic'`). No `kind`, `changes` or `simulated`. `kind` is `replan` when its approval belongs to an emergency case; `changes` come from the `plan.proposed` payload (`added`/`moved`/`dropped`). |
| Approval | `payload.plan_id` becomes `plan_id`. `commit_plan` becomes `activate_schedule` or `activate_replan`; other actions (`retry_schedule`, `escalate`, `notify_resident`) pass through (type widened). `outcome` becomes `reason`. |
| Event | Same fields plus a retained `sequence` and `simulated`. Notifications are derived client-side from case, emergency, plan and job events. |
| Report | No list endpoint, so `state.reports` is `[]` in api mode. Contact details live only in the backend's private store. |
| Property | The register has no street address. `display_address` is `Home p-NNN, <area>` and `postcode` is the district (for example `S4`). Its coordinates differ from the frontend fixtures for the same `p-NNN` IDs. `synthetic: true` is kept. |

## Tests

**Automated** (all run on this branch)
- Backend: `backend/tests/test_platform.py` has 9 tests covering health/reset flag, property search, contact privacy across events/SSE/case JSON, multipart contact fields, the public case view, the full job-progress flow including 404/409/422, stream filters, dev reset and events tail.
- Full backend suite with mock settings (`USE_MOCKS=true INTAKE_ADAPTER=mock AGENT_RUNTIME=mock SCHEDULER=mock SCHEDULER_ADAPTER=mock py -3.13 -m pytest backend`): **50 passed**. With the local `.env` (`USE_MOCKS=false`, real model adapter) 14 existing tests fail because they call the real model endpoints; that is unrelated to this branch.
- Frontend platform tests:
  - `shared/mock/api/api.test.ts`: mapping, reducer duplicates and out-of-order events, stream reconnect/backoff/resume with a fake `EventSource`, service load, patch and connection states, typed errors, resident scope and multipart.
  - `shared/mock/trackedCase.test.ts`: public endpoint only, per-case stream, not_found/idle.
  - `shared/theme/theme.test.tsx`: pre-paint system/stored/invalid values, the serialised inline script, `useTheme`, `ThemeControl`.
  - `shared/mock/localService.test.ts`: re-plan keeps work, transitions, evidence count, property search.
- Operative: `portals/operative/OperativePortal.test.tsx` has 12 tests.
- `npm test`: **58 passed, 4 failed**. All 4 failures are Resident/Operations tests that use the old synchronous calls.
- `npm run typecheck`: **17 errors, all in `portals/operations` (14) and `portals/resident` (3)**, for the same reason. Because `build` runs `tsc -b` first, `npm run build` stops there until those portals add `await`. `build:resident` and `build:staff` both succeed.

**Bundle split**
- `dist/resident`: `index` 270 kB and `ResidentApp` 89 kB of JS. A search for `maplibre`, `deck.gl`, `OperationsPortal` and the Operative markup finds nothing.
- `dist/staff`: `TwinMap` (2.0 MB, MapLibre and deck.gl), `OperationsPortal` and `OperativePortal` are separate lazy chunks.

**Browser checks** (headless Chrome 13 Nov 2026, driven over the DevTools protocol; real backend with mocks on port 8011, staff dev server 5174, resident dev server 5183 on localhost)
- Operative at 1440×900 in light and dark: no console errors, and the header shows **Live** and **Test mode**.
- Resident app at 390×844 in light and dark: no console errors. Network on load was `/api/health` only.
- No flash of the wrong theme: `data-theme` is present in the served HTML before any script module runs (inspected in the DOM dump).
- Report sent through the resident proxy → `case.created` on the staff stream in about **0.7 s**.
- Two staff tabs: "Start travelling" in tab A showed **Travelling** in tab B after **659 ms** without a reload, and the backend recorded `travelling`.
- Contact details: the phone, name and access notes did not appear on the stream (0 matches). Staff `/api/jobs` shows the access notes.
- Schedule path (`schedule_job` then `request_approval`) produces an unapproved plan with a pending `commit_plan` approval.

**Not tested**
- Two physical devices or a real phone (including over HTTPS and with the firewall prompt).
- `dev:resident:https` in a browser.
- The full Operations UI flow in api mode: that portal still makes synchronous calls.
- Screen readers. Keyboard behaviour is covered by tests (radio group, Escape, focus return).
- The 1920×1080 and 1024×768 viewports were not screenshotted.

## Limitations and requested backend changes not made

- **Evening scheduling bug:** reports made after the fixture shifts could not be planned in demo-clock mode. `main` fixed this in parallel (case times translated onto the demo clock); that fix was kept during the merge and `/api/jobs` uses the same translation.
- A job marked `unable_to_complete` keeps that status if a later approved plan reassigns it. Progress should be cleared for re-planned jobs on approval.
- `generateScheduleProposal` uses the agent tool endpoints (`schedule_job` then `request_approval`). A dedicated `POST /api/cases/{id}/schedule` would be cleaner.
- `ReportIn` has no category. The resident's category is only used to word the generated text for media-only reports.
- SSE polls SQLite every second in one process. Multi-worker deployment needs a broker (already noted in `docs/BACKEND_INTEGRATION.md`).
- `recordActivity` in api mode stays in that browser (no backend endpoint).
- No authentication: the staff server binds to localhost only. See the README's known-risk note.

## Merge into main (13 Nov)

- `main` had gained a second data layer (`shared/data/ApiHomeShieldService`, calling FastAPI directly on port 18100, with job progress kept only in the browser). Operations and the round-1 Operative had been switched to it.
- Resolution: the contract service in `shared/mock` is the single data layer. `shared/data/index.ts` is now a compatibility wrapper (`homeShieldService`, `useConnectionState`, `isApiMode`, `switchDataSource`), so Operations works unchanged and is fully awaited. The duplicate service, mappers and tests were removed (recoverable from git history). "Use demo data" (`switchDataSource`) and `VITE_DATA_SOURCE=mock` are still honoured.
- Kept from `main`: the logo (header and favicon) and the backend changes.
- Test-only fixes in the Resident and Operations folders: added `await`s and valid progress notes.
- Job progress now also allows a return visit (unable to complete → travelling or on site) in both backend and local mode.
- After the merge: backend 55 passed; frontend typecheck clean; 72/72 tests pass; `npm run build` builds both apps; the resident bundle has no staff or map code.

## Notes for the integrator and portal owners

**Resident** (`portals/resident`)
- `await mockService.createReport(...)` (ResidentPortal.tsx around line 147).
- Pass `photo`/`audio` Blobs instead of `evidence` descriptors, and `address_line`/`postcode` for homes not in the register.
- Use `mockService.findProperties(q)` instead of `useDemoState((s) => s.properties)`, and `useTrackedCase(ref)` instead of reading `cases`/`reports`/`jobs`. All of these are empty in the resident app in api mode by design.
- Delete any `CONTRACT-STANDIN` stand-ins for `useConnection`, `findProperties` and `useTrackedCase`, and import them from `../../shared/mock`.
- Replace "Resident portal · Demonstration" copy.

**Operations** (`portals/operations`)
- Await `generateScheduleProposal`, `approveProposal`, `rejectProposal`, `simulateEmergency`, `reset` and `recordActivity` (OperationsPortal.tsx around lines 177–245; `lib/derive.test.ts`).
- `EMERGENCY_CASE_ID = 'HS-EMERGENCY-1'` exists only in local mode. Use the `case.id` returned by `simulateEmergency()`.
- Only show reset when `useConnection().canReset` is true.
- The forced dark theme is gone: define map palette tokens under `[data-theme="light"]` and `[data-theme="dark"]`, and re-read them on theme change (`TwinMap` reads the palette once with `useMemo([])`).
- Delete `CONTRACT-STANDIN` code after merging.

**Contract additions**, which should be adopted in `v2-00-shared-contract.md`:
- `startLiveData()`, `checkHealth()`, `ApiError` and `DATA_MODE` exports.
- `Job.source`, `hazard_type`, `severity` and `access_notes`.
- `AgentActivity.sequence`.
- `updateJobProgress`'s fourth argument, `evidenceCount`.
