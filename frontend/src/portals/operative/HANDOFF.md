# Operative portal handoff

Route: `/operative`. Only `frontend/src/portals/operative/**` was changed.

## Files

- `OperativePortal.tsx`: worker selector, identity, next job, later and finished lists, route-change banner, empty and offline states
- `JobCard.tsx`: job details, progress buttons, completion and unable-to-complete confirmation form, photo picker
- `RoutePreview.tsx`: offline schematic route (straight lines, labelled as such)
- `model.ts`: joins active approved assignments to jobs, cases, properties and reports; formatting helpers
- `operative.css`: portal styles using only global tokens
- `OperativePortal.test.tsx`: 9 tests

## Checks run

- `npm run typecheck`, `npm test` (12 passed: 9 operative and 3 shared), and `npm run build` all pass.
- Headless Chrome screenshots at 360px and 390px (exact-width iframes) and at 1280px: no horizontal scroll, and buttons are at least 44px.
- Automated: pending proposal not shown until approved; joins by ID; worker switching; no-assignment state; travelling, on site, completed (notes required) and unable to complete (reason and notes); live update and explanation when the emergency re-plan is approved; no false route-change banner after a demo reset; note shown when the page is opened after a re-plan; Escape cancels the confirmation and returns focus.
- Not done: real phone browser, manual two-tab run, screen-reader pass.

## Requests for shared code (architect)

1. **The re-plan drops existing work.** `approveProposal` marks every earlier assignment inactive. Approving `plan-emergency-replan` therefore removes Dan Clarke's HS-26041 rather than adding the gas job to his route. HS-26041 also stays `assigned` but now has no active assignment. Suggested fix: for `kind: 'replan'`, deactivate only the assignments for jobs listed in `proposal.changes`, or include the worker's existing stops in the re-plan proposal. The portal currently shows "No longer assigned to you: HS-26041".
2. **No evidence count parameter.** `updateJobProgress(jobId, status, notes)` cannot record a photo count. Please add an optional `evidenceCount` argument that sets `Job.evidence_count`. For now the portal appends "[n photos selected on device; not uploaded in demonstration]" to the notes.
3. **No transition validation.** `updateJobProgress` accepts any status, for example going from completed back to assigned. The portal enforces assigned → travelling → on site → completed or unable to complete, but the service should reject invalid transitions before a real backend arrives.
4. **No test browser environment.** Vitest has no jsdom environment configured, so the operative test file opts in with a `// @vitest-environment jsdom` comment. A shared `test.environment` setting would make this consistent across portals.
