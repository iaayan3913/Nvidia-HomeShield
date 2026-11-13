# Developer 3 — Operative portal implementation

You are implementing the Operative portal for HomeShield, an NVIDIA Hack for Impact social-housing repair coordination demonstration. Build the actual working portal.

## Scope and ownership

Edit only `frontend/src/portals/operative/**`. Everything else is read-only. Read `DESIGN_SYSTEM.md` and `README_PARALLEL_DEVELOPMENT.md`; use shared components, tokens, Lucide icons and `mockService`/`useDemoState`. Do not add authentication, a new store, API client, CSS framework, dependencies or independent fixtures. Request shared changes in the handoff.

## Experience

Build a clean mobile-first field interface that answers: what is next, where, how urgent, what work is required, and what action follows. It must feel practical rather than like a reduced officer dashboard.

Add an obvious “demonstration user” worker selector from shared workers. Display role, skills and shift. Show the next job and remaining active assignments using the active shared plan only; proposals must never appear as assigned work. Order by assignment ETA. Join jobs, cases and fictional properties by ID.

Job details include reference, short problem summary, fictional address/postcode, time window, priority, required skill, safe access notes when available, and a compact local location/route preview. A schematic offline preview is acceptable; label straight-line geometry as schematic. Do not claim turn-by-turn navigation.

Provide progress actions for assigned → travelling → on site → completed or unable to complete. Require concise completion/unable notes where appropriate and call `mockService.updateJobProgress`. Add an evidence selection UI with previews if useful, but keep binary media in component memory and record only a count/descriptor; never persist object URLs or blobs. Confirm consequential status changes and show accessible feedback.

When Operations approves a normal or emergency plan, subscriptions must update the visible assignments without reload. Clearly explain when a worker’s route changed. Provide strong empty, completed, offline/demo and error states.

## Acceptance criteria

- `/operative` is excellent at 360px, remains coherent on desktop and has 44px targets.
- Switching workers changes identity, skills and active job list.
- Only active approved assignments appear; pending proposals do not leak into the schedule.
- Job details are joined from the shared typed state, not duplicated fixtures.
- Valid progress transitions update shared jobs/cases and are visible in Operations state.
- Approval of the emergency re-plan updates assignments live.
- Priority is conveyed with text/icon as well as colour; emergency remains red.
- Forms, confirmations, errors and empty states are keyboard and screen-reader friendly.

## Test and handoff

Run `npm run typecheck`, `npm test`, and `npm run build`. Test at 360px, 390px and desktop; worker switching; no-assignment state; initial assignment; every progress action; completion notes; proposed-versus-active separation; and an approved emergency re-plan from a second tab. Report files, exact tests/viewports, screenshots if any, limitations, shared requests and commit hash. Edit no shared files and do not merge branches.
