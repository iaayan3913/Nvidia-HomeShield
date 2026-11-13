# Developer 2 — Operations portal and Sheffield digital twin

You are implementing the Operations portal for HomeShield, an NVIDIA Hack for Impact social-housing hazard and repair coordination demonstration. This is the hackathon’s visual centrepiece. Build and test working React components, not a design proposal.

## Scope and ownership

You may edit only `frontend/src/portals/operations/**`. All root app/router files, `package.json`, global styling, shared components/types/mock service, public datasets and other portal directories are read-only. If you need a shared contract change, specify the minimal change in your handoff for the integrator. Do not add a global store, styling framework, API client, separate fixtures or backend connection.

Read `frontend/DESIGN_SYSTEM.md` and `frontend/README_PARALLEL_DEVELOPMENT.md`. Use:

```ts
import { mockService, useDemoState } from '../../shared/mock';
```

Shared dependencies already include MapLibre GL and deck.gl (`@deck.gl/react`, `@deck.gl/layers`, `@deck.gl/mapbox`). Lucide provides icons. Put every Operations component, hook, utility and stylesheet in your owned directory.

## Spatial design

The Sheffield digital twin is the workspace, not a card inside a dashboard. Use a full-height dark map canvas beneath a slim operational header. Prefer one collapsible case rail, one contextual property/case inspector and a compact bottom schedule/activity drawer. Avoid three permanent sidebars, dense card grids, floating labels everywhere and a giant Gantt chart.

Create an offline-first MapLibre/deck.gl composition. Load local `/roads-major.geojson` and `/properties.geojson`. Read each collection’s `metadata`; display “Synthetic housing stock” and the road source/attribution. Never call synthetic points real addresses or exact building footprints. The property data contains points and `floors`, not footprints: render tasteful schematic extruded columns or 3D markers and label the representation “schematic”. If an optional internet basemap fails, the local dark background, local roads, markers, workers and routes must still work.

Required camera controls: pan, zoom, rotate, pitch, reset and smooth focus. Provide keyboard-accessible alternatives through the case/property lists. Keep controls compact. Initial Sheffield view should frame the fixture extent. Selecting a case/property must highlight it, move the camera without disorienting animation, open its inspector and show hazard, state, evidence summary, deadline review state and related job. Honour reduced motion.

Layer requirements:

- local road context with source label;
- synthetic property stock, visually quiet until relevant;
- case properties coloured by severity using shared semantic colours;
- selected property with green focus distinct from emergency red;
- worker positions from shared workers/current route endpoints;
- active approved routes drawn solid and legible;
- proposed route changes drawn dashed or otherwise unmistakably pending;
- job stops and route direction/sequence where useful;
- layer toggles for properties, cases, workers and routes, tucked into one control.

Routes are ordered stop waypoints, not road geometry. Connect them schematically and label that fact. Do not fabricate street-following navigation. Proposed routes must not replace active routes before approval.

## Operational workspace

Build a compact summary with only open cases, emergencies, jobs due soon and available operatives. Derive values from shared state. Add a usable case list with search, urgency/status filters, reference, problem, area, due/review state and assigned operative. Selection drives the map and inspector. Long descriptions need readable expansion rather than a narrow permanent column.

Provide a compact schedule drawer that compares the active plan with the newest proposal. Resolve worker/job/property names from shared IDs. Show ordered visits, ETAs, unassigned jobs, conflicts, and proposal `changes` (added/moved/dropped). Clearly label solver results as deterministic simulated data and display no fabricated model reasoning.

Provide an on-demand AI activity timeline from shared `activity`: report received, classification proposed, deadlines calculated, scheduling requested, result returned, approval requested and activation. These are human-readable simulated action summaries, never hidden chain-of-thought. Avoid a permanently crowded activity sidebar.

## Human approval and emergency workflow

For unassigned cases, offer “Create schedule proposal” and call `mockService.generateScheduleProposal(caseId)`. The officer must inspect it before approval or rejection. Approval calls `approveProposal(planId, 'demo-officer')`; rejection captures a brief reason and calls `rejectProposal`. Keep the prior active plan visible until approval succeeds. Display accessible confirmation and errors.

Make “Simulate emergency” prominent but controlled. On activation call `mockService.simulateEmergency()` exactly once. Then:

1. Focus `HS-EMERGENCY-1` at property `p-110`.
2. Update emergency summary and case list from state.
3. Reveal the red emergency marker without constant flashing.
4. Show the shared simulated emergency activity.
5. Display the pending revised route alongside, not instead of, the active route.
6. Open the proposal comparison and human approval controls.
7. After approval, animate the route transition and show the new active assignments.

Provide “Reset demonstration” with confirmation, calling `mockService.reset()`, then reset local selection, drawers and camera. Do not auto-approve a re-plan. A repeated emergency click must not duplicate the emergency.

## Performance and resilience

Memoise deck.gl layers and joins, avoid rebuilding hundreds of property objects on every pointer event, and clean up map resources. Keep property picking responsive with 400 points. Provide loading, malformed GeoJSON, unavailable WebGL and offline states. A useful 2D fallback/list must remain available if WebGL cannot initialise. Do not log resident contact data.

The portal must adapt below 1024px: map remains useful, panels become drawers/sheets, controls do not overlap, and no text becomes unreadable. Mobile Operations is secondary but must not break.

## Acceptance criteria

- `/operations` is visually polished at 1440×900 and functional at 768px/390px.
- The map starts offline using local files; dataset source/limitations are explicit.
- Pan, zoom, rotation, pitch, reset, property picking and list-driven focus work.
- Case/property selection stays synchronised with the inspector.
- Shared resident submissions appear without reload and can be located.
- Counters/search/filters/schedule/activity all derive from shared state.
- Active and proposed plans are visually and semantically distinct.
- Approval is mandatory before routes/operative assignments change; rejection preserves the active plan.
- Emergency simulation creates one case/proposal, focuses it and supports review/approval.
- Reset returns shared and local UI state to the deterministic baseline.
- All map controls, drawers, dialogs and decisions are keyboard accessible; status is not colour-only.
- Browser console has no errors during the full flow.

## Required testing and handoff

From `frontend/`, run `npm run typecheck`, `npm test`, and `npm run build`. Test with network disabled; 1440×900, 1024×768 and 390×844; keyboard-only case selection and approval; WebGL failure fallback; new resident case from a second tab; proposal rejection; proposal approval; emergency; route transition; operative assignment update; and reset. Inspect console and rendering. Only report tests actually performed.

Your handoff must list files changed, map/layer architecture, local assets used and their metadata source, workflow tests, exact viewports, accessibility checks, screenshots if taken, performance notes, limitations, requested shared changes and commit hash. Do not edit shared files, merge, or claim the full integrated product is complete.
