# Prompt C: case list, less text, and schedule status

**Owner: Person C.** Copy everything below the line into your coding agent.

---

You are working on HomeShield, a hackathon demo (NVIDIA Hack for Impact, Sheffield, today). It has a React + TypeScript + Vite frontend in `frontend/` and a FastAPI backend in `backend/`. Read `docs/ui-rework/README.md` first: it lists the shared rules and the backend API. Work on a new branch from `main`.

**Before you start:** pull `main` and check that `frontend/src/` contains the real dashboard source, for example a `TwinMap` component and `src/lib/theme.ts`, not just the 14-line starter `main.tsx`. Enan (workstream A) is uploading it as his Step 0. If it isn't there yet, stop and say so; do not try to edit the compiled `mock-build/` bundle.

**You own:** the case list and case cards on the left, the case detail panel, the header counters and status strip, toasts and notifications, the contents of the "Today's schedule" component (workstream A moves it into a Schedule tab; you trim what is inside), and the **shared live data layer** (one module the whole app reads cases, plans, workers, approvals and SSE events from). **Do not change** map layers (workstream B) or the layout, tabs and resident page (workstream A, which merges first, so rebase onto it).

## Why

The operator needs to triage at a glance. Right now the case list is packed tightly but still hides the key facts until you click, and the dashboard has too much text overall. The "PLAN v2 · re-planned" label also means little to an operator.

## Tasks

1. **Redesign case cards.** Each collapsed card shows only what is needed to triage, in two short lines:
   - a severity colour bar or chip (`docs/CONTRACTS.md` colours), a hazard icon and a short title (for example "Damp & mould · bedroom");
   - the area (district from `properties.geojson`, for example "S2 · Manor"), a **deadline countdown** ("4 h left", turning amber or red as it gets close), and the status (Awaiting approval, Scheduled with the assigned worker's name and ETA, In progress, Resolved).
   - Badges only when true: emergency, vulnerable occupant, at risk of missing deadline.
   - More space between cards, a clear selected state, and no paragraph text on the card. The AI summary, evidence photo, full deadlines and activity go in the detail view on click.
   - Sort by urgency: emergencies first, then nearest deadline. Add a compact filter for all / emergency / awaiting approval / scheduled.
   - Clicking a card selects it, and should also tell the map which case is selected (agree the shared selection state with workstream B).
2. **Cut text across the dashboard.**
   - Header counters become four compact numbers with one-word labels: Open, Emergencies, Awaiting approval, On track %.
   - Remove explanatory sentences that repeat what the UI already shows. Prefer icons with tooltips over labels where meaning is clear.
   - Show timestamps as relative times ("3 min ago").
   - Keep the Schedule tab content to one row per worker: name, skills icons, visit count and next stop.
3. **Replace "PLAN vN".**
   - The current UI counts plan versions on the client ("Plan v1 published", "PLAN v2", "Re-planned N existing visits"). The backend plan has no version number, so this label would not even exist in live mode.
   - Replace it with what matters to the operator:
     - a small status line, "Schedule updated 11:02";
     - and, after a re-plan, a toast: "Re-planned in 1.1 s · cuOpt · 2 visits moved · all deadlines on track".
   - Build the toast from `plan.solver`, `plan.solver_ms`, `plan.conflicts` and `plan.unassigned_jobs`, plus a diff of the previous and new routes. Show "No other visits moved" when the count is zero.
   - Keep the solver name and time visible in the toast: it is how judges see the NVIDIA cuOpt part of the demo.
4. **Shared live data layer.** Create one module, for example `src/lib/live.ts` with a React context or hook.
   - It exposes `cases`, `activePlan`, `proposedPlan`, `workers`, `approvals` and `events`.
   - **Mock mode:** the existing demo data, unchanged behaviour.
   - **Live mode:** when the app talks to the backend through the `/api` proxy set up by workstream A, fetch `GET /api/cases`, `/api/plans/active`, `/api/workers` and `/api/approvals`. Then subscribe to `GET /api/stream` with `EventSource`, using `addEventListener` per named event type (`case.created`, `case.status_changed`, `plan.proposed`, `plan.replan_completed`, `plan.activated`, `approval.requested`, …). Refetch the affected resource on each event, and reconnect automatically.
   - Workstreams A and B read from this module. Land it early, even before the card redesign is finished.

## Done means

- [ ] Collapsed cards show severity, hazard, area, deadline countdown, status, and worker plus ETA when scheduled, with no paragraphs. Detail opens on click.
- [ ] The list is sorted by urgency and filterable. Selecting a card highlights the case on the map.
- [ ] No "PLAN vN" anywhere. After a re-plan, the toast shows solver, time and visits moved, including the zero case.
- [ ] A visibly shorter header and status strip. No sentence longer than about 10 words on the main dashboard.
- [ ] Live mode: a new report or emergency appears in the list within about 2 seconds without reloading. Mock mode still works with no backend.
- [ ] `npm run build` passes with no TypeScript errors.

When you finish, report what you changed, what you tested in mock and live mode, and anything left for A or B.
