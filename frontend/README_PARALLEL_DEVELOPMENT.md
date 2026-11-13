# Parallel frontend development

## Foundation

This Vite/React/TypeScript application is intentionally split into three independently owned portals. The architect owns everything outside the portal directories. Each feature developer starts from the exact same foundation commit and edits only their assigned directory.

Routes:

- `/report` → `src/portals/resident/`
- `/operations` → `src/portals/operations/`
- `/operative` → `src/portals/operative/`

The app shell, router, design tokens, shared components, typed domain layer and deterministic mock service already exist. Do not add another router, store, styling framework, API client or mock dataset.

## Shared design and state

Read `DESIGN_SYSTEM.md` before implementation. Reuse `src/shared/components`, Lucide icons and global tokens. Portal-specific CSS and components stay inside the portal's directory.

Import the workflow through:

```ts
import { mockService, useDemoState } from '../../shared/mock';
```

`useDemoState(selector)` subscribes React to the state. `mockService` provides stable actions:

- `createReport(input)`
- `getCases()`, `getProperties()`, `getWorkers()`
- `getAssignedJobs(workerId)`
- `generateScheduleProposal(caseId?)`
- `approveProposal(planId, decidedBy?)`
- `rejectProposal(planId, reason, decidedBy?)`
- `simulateEmergency()`
- `updateJobProgress(jobId, status, notes?)`
- `recordActivity(event)`
- `reset()`

The service persists fictional structured demo state under `homeshield.demo-state.v1` and syncs same-origin tabs via `BroadcastChannel` plus the storage event. It never persists uploaded binary media or object URLs. A proposed plan never changes routes or operative assignments until `approveProposal` activates it. Rejecting a proposal preserves the prior active plan.

The future FastAPI seam is `MockService` in `src/shared/types/domain.ts`. Portal components should render models and call service methods rather than access local storage or construct backend payloads directly. Backend-compatible names are retained where practical. When integration begins, introduce an implementation matching this interface, multipart upload handling and SSE adapters centrally.

## Ownership

| Owner | Writable files | Read-only files |
|---|---|---|
| Architect / integrator | `package.json`, router/app, `src/shared/**`, `src/styles/**`, public datasets, root frontend docs | Portal work while developers own it |
| Resident developer | `src/portals/resident/**` | Everything else |
| Operations developer | `src/portals/operations/**` | Everything else |
| Operative developer | `src/portals/operative/**` | Everything else |

If a shared change is required, document the exact request in the handoff; do not modify shared files. Do not edit another portal, backend Python, generated backend data, root environment files or package configuration.

## Local datasets

`public/properties.geojson` and `public/sample-properties.json` are deterministic synthetic properties. `public/roads-major.geojson` is the committed offline road context and its `metadata.source` states whether it is OSMnx or a synthetic fallback. Operations must inspect and display the source label. No property is a real resident address. Shared fixture properties are in `src/shared/mock/fixtures.ts` and use fictional display addresses.

## Run and test

From `frontend/`:

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

All three routes run in one application; open the assigned URL directly. Each developer must test desktop and mobile, keyboard navigation, empty/error states, a clean reset, and the assigned segment of the shared scenario. Never claim browser or mobile testing that was not performed.

## GitHub Desktop workflow

The owner first commits and pushes this foundation to `frontend/integration`. Every developer then:

1. Fetches origin in GitHub Desktop.
2. Checks out `frontend/integration` and pulls it.
3. Confirms the foundation commit hash matches the team's agreed hash.
4. Chooses **Current Branch → New Branch** and creates exactly one branch: `frontend/resident`, `frontend/operations`, or `frontend/operative`.
5. Implements only the owned directory, commits coherent changes and publishes the branch.
6. Does not merge `main`, another portal branch, or rewrite shared files.

The designated integrator checks out `frontend/integration`, fetches origin, and uses **Branch → Merge into current branch** for each portal branch. Because ownership is disjoint, conflicts should indicate a boundary violation and should be resolved centrally. The integrator runs the full workflow and build before creating any pull request to `main`.

## Common integration scenario

All portals must support this same state sequence: resident submits a mould report → Operations locates the case and creates a proposal → officer approves → assigned operative sees and progresses the job → Operations reflects progress → officer simulates an emergency → reviews the proposed re-plan → approves it → routes and operative assignments change. Every automated step is explicitly labelled simulated.

## Handoff format

Each developer reports: files changed; features completed; exact tests and viewports used; shared workflow steps verified; screenshots if taken; accessibility checks; limitations; and any requested shared change. Include the final commit hash and do not claim full end-to-end integration before the integrator has merged all three branches.
