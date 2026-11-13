# Round 2 · Agent 3: Platform (two apps, theme, live backend) and the Operative dashboard

You own the foundations that make HomeShield a real two-device product, plus the **Operative** dashboard:

- separate resident and staff apps
- light and dark themes
- a live connection to the FastAPI backend, so a report sent from a phone arrives on the staff laptop

**Before you start**, read `frontend/tasks/v2-00-shared-contract.md` (binding; you implement most of it), `frontend/README_PARALLEL_DEVELOPMENT.md`, `docs/CONTRACTS.md`, `docs/BACKEND_INTEGRATION.md`, `backend/app.py` and `backend/schemas.py`. Create branch `frontend-v2/platform` from the latest `main`. You may edit the files the contract assigns to "Operative + Platform". Backend changes must be **additive**: do not change existing response shapes, and add tests in `backend/tests/`.

The Resident and Operations agents are working in parallel against the contract, with local stand-ins. Land the contract surface (types, exports, the theme attribute) early and keep it exactly as specified.

## Feedback this round must resolve

1. Light and dark mode across all dashboards.
2. It must read as a real service, not a fictional demonstration.
3. The resident app (phones, tablets, laptops) and the staff apps (Operations and Operative, on a laptop or PC) are separate products on separate devices. A report sent from the phone must be received on the laptop.

## A. Two applications

- **Resident app**: resident routes only (`/report`, `/report?view=track&ref=…`), with its own minimal header (brand, theme control, no staff links).
  - Scripts: `npm run dev:resident` (port 5173, exposed on the LAN) and `npm run build:resident` (output to `dist/resident`).
  - Its bundle must not include MapLibre, deck.gl or staff code; verify in the build output.
- **Staff app**: `/operations` and `/operative`, with navigation between them and a theme control.
  - Scripts: `npm run dev:staff` (port 5174) and `npm run build:staff` (output to `dist/staff`).
- Keep `npm run dev`, `npm test`, `npm run typecheck` and `npm run build` working; `build` builds both apps.
- Suggested approach: Vite multi-page or mode-based entries (`src/app/resident/`, `src/app/staff/`) with lazily loaded portal routes. Choose what is simplest to keep correct.
- **Dev proxy.** Both dev servers proxy `/api` (including the `/api/stream` SSE, unbuffered) to `VITE_BACKEND_URL` (default `http://127.0.0.1:8001`). The frontend uses relative `/api` URLs only.
- **HTTPS on the LAN.**
  - Provide an HTTPS option for the resident dev server (for example `npm run dev:resident:https` using `@vitejs/plugin-basic-ssl`, or mkcert), so phones get a secure context for microphone recording.
  - Document the self-signed certificate warning and the Windows firewall prompt.
- **Backend binding.** Document running the backend on `0.0.0.0:8001`, and update `CORS_ORIGINS` guidance (the proxy makes it unnecessary in development, but document it for production builds).

## B. Theme system (all dashboards)

- Light and dark token sets on `<html data-theme>`, keeping every existing token name (see the contract). Both themes must meet WCAG 2.2 AA for text, borders used as boundaries, focus rings and status colours.
- An inline script in every HTML entry sets `data-theme` before first paint from `localStorage['homeshield.theme']` (`light`, `dark` or `system`). It also updates `<meta name="theme-color">`.
- `src/shared/theme/`: `useTheme()` returning `{ theme, preference, setPreference }`, and an accessible `ThemeControl` (Light / Dark / System, keyboard operable, with an announced state) placed in both app headers.
- Remove the `[data-portal="operations"]` forced-dark override. Make shared components work in both themes: Button, form controls, StatusBadge, toasts, ErrorBoundary.
- Toasts currently render outside the themed app container; fix this.

## C. Live data service

- Implement an `api` adapter behind the existing `mockService` export (keep the import path and `MockService` method names). Select it with `VITE_DATA_MODE=api` (the default) or `local` (the current in-browser mock, used for tests and offline work).
- **Initial load:** use the existing endpoints (`/api/cases`, `/api/workers`, `/api/plans/active`, `/api/plans/latest`, `/api/approvals`, `/api/events`, plus the new ones below) to build the same `DemoState` snapshot `useDemoState` serves today.
- **Live updates:** consume `/api/stream` with `EventSource`, listening for **named** events (`report.*`, `case.*`, `plan.*`, `job.*`, approvals). Reconnect with backoff; the browser manages `Last-Event-ID`. Patch or refetch only the affected resources.
- **Connection status:** expose it through `useConnection()` as specified. Read `/health` for `simulatedServices` (`mocks`).
- **Schema mapping:** map backend schemas to frontend domain types in one adapter module, and document every field difference in your handoff. The backend's property register (`data/generated/properties.json`) replaces the frontend fixture properties in `api` mode; the two use different coordinates for the same `p-NNN` ids.
- **Reports with media:** `createReport` sends multipart (`text`, `property_id`, `photo`, `audio`) when media is present and JSON otherwise. Never set the multipart boundary by hand.
- **Errors:** return typed errors with user-safe messages and an HTTP status.
- **New contract surface:** `useConnection()`, `findProperties()`, `useTrackedCase()`, and the extended `CreateReportInput`.
- **Resident scope.** The resident app must never fetch the full case list or subscribe to other residents' data.
  - `useTrackedCase` fetches `/api/cases/{ref}` and follows only the SSE events for that case.
  - Request a resident-safe case view from the backend if `/api/cases/{id}` exposes internal fields.

## D. Minimal backend additions (additive, tested)

- `GET /api/properties?q=`: postcode/address search over the property register.
- An operative job-progress endpoint: either reuse `PATCH /api/cases/{id}/status` if it is sufficient, or add `POST /api/jobs/{job_id}/progress` with `{status, notes}`. Either way it emits an SSE event that Operations can show.
- Optional resident contact details and a structured address (`address_line`, `postcode`) on report submission. Store contact details privately; never include them in SSE payloads, `/api/events` or logs.
- `POST /api/dev/reset`, enabled only when `ALLOW_DEV_RESET=true`, and reported through `/health` so `canReset` is truthful.
- Coordinate with whoever owns `backend/` if you are not that person. Note any untested adapters honestly.

## E. Operative dashboard (staff, laptop/PC)

- Optimise for laptop and PC (1280×800 to 1920×1080); keep it usable on a 1024×768 tablet. Both themes.
- Real-service language:
  - Replace "Operative · demonstration user" and fictional-data notes. Use "Viewing as" for the staff selector; there is no authentication this round.
  - Label only genuinely simulated parts, through `simulatedServices`.
- `await` all job progress calls, with pending, error and retry states. Show a live connection indicator.
- Progress changes must appear in Operations on another device without a reload.

## F. Documentation

Add a README section, "Run HomeShield on two devices", covering:

- the exact commands for the backend, staff app and resident app
- finding the laptop's LAN IP (`ipconfig`)
- the firewall prompt and the HTTPS certificate warning
- the environment variables (`VITE_DATA_MODE`, `VITE_BACKEND_URL`, `ALLOW_DEV_RESET`, `CORS_ORIGINS`)
- a troubleshooting list, including stale Vite dependencies (`npm run dev -- --force`) and WebGL checks (`chrome://gpu`)

**Known risk to record:** the staff dashboards have no login. Anyone on the network who knows the URL can open them. Do not expose them publicly.

## Tests

- **Unit tests:**
  - backend-to-frontend schema mapping
  - the SSE event reducer, with a fake `EventSource`, including reconnect and out-of-order events
  - `useConnection` states
  - the theme pre-paint logic and `useTheme`
  - the resident scope (no full-list fetch)
- Existing tests keep passing in `local` mode. Backend tests for the new endpoints pass.
- **Browser checks:**
  - both apps in both themes, with no flash of the wrong theme on load
  - the resident app at 390×844 and the staff app at 1440×900
  - laptop-only two-tab flow: report → proposal → approval → operative progress → Operations update
  - a real phone on the same Wi-Fi submitting a report that appears on the laptop within about 2 seconds
  - say exactly which of these you could and could not test

## Handoff

Follow the contract's definition of done. Also include:

- the run commands and topology diagram
- the schema differences found
- the new endpoints and their tests
- bundle-split evidence
- requested backend changes you did not make
- notes for the integrator on removing the Resident and Operations `CONTRACT-STANDIN` code after merge
