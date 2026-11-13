# Developer 1 — Resident portal implementation

You are implementing the Resident portal for HomeShield, an NVIDIA Hack for Impact social-housing hazard reporting demonstration. Build working React components, not a plan or static mock-up.

## Scope and ownership

You may edit only `frontend/src/portals/resident/**`. Treat the router, package files, shared types, mock service, global CSS, public assets and the other portals as read-only. If a shared change is essential, describe it in your handoff instead of editing it. Do not connect FastAPI, AI models or real notification services.

Read `frontend/DESIGN_SYSTEM.md` and `frontend/README_PARALLEL_DEVELOPMENT.md`. Import shared state from `../../shared/mock`, controls from `../../shared/components`, notifications from `../../shared/notifications/NotificationProvider`, and icons from Lucide. Put Resident-only CSS, components and hooks inside your owned directory.

## Experience

Create a light, welcoming, mobile-first reporting journey with four understandable stages: problem, evidence, property/contact, and review. Use restrained green accents, excellent labels and plain British English. It must not look like an admin dashboard.

Implement category choices for damp/mould, leak, electrical, heating/hot water (map to `other` with a local display label), gas, doors/windows/locks (`other`), structural damage (`other`) and other. Collect a description, but allow photo or voice evidence to substitute. Show clear errors at the relevant step.

Evidence must support multiple local photo previews, removal, microphone recording where `MediaRecorder` is supported, playback/deletion and a useful denied/unsupported fallback. Keep `File`, `Blob` and object URLs only in component memory; revoke URLs on removal/unmount. Pass only evidence descriptors to `mockService.createReport`; never store media bytes, local paths or object URLs in shared state.

Use fictional properties from `useDemoState(state => state.properties)`. Selecting one should prefill its fictional address/postcode without requesting excessive resident details. Collect name, contact number, preferred contact method and optional access notes. Make it explicit that these are fictional demo details and are persisted only as mock structured state.

Review should summarise inputs and provide one principal “Submit repair report” action. Call `mockService.createReport(...)`; show the returned reference, what happens next, and whether the simulated classification requires urgent human attention. Never claim AI analysis or a guaranteed legal deadline. Provide simple tracking by reference using shared cases.

Keep safety guidance visible and context-sensitive: immediate danger → 999; gas emergency in Great Britain → 0800 111 999; HomeShield does not replace emergency services.

## Acceptance criteria

- `/report` is polished at 360px and desktop widths, fully keyboard usable, with 44px targets.
- Step state survives forward/back movement in the current session.
- Validation covers absent evidence/description, property, name, phone and preferred contact.
- Photo previews and voice controls work where supported and fail gracefully.
- Submission creates exactly one shared report/case and shows its reference.
- A submitted mould case is immediately observable through shared state in another same-origin tab.
- Media content is never written to local storage.
- Loading, disabled, error, empty, reset/new-report and confirmation states are complete.
- Copy labels all classification/workflow output as simulated and uses British English.

## Test and handoff

Run `npm run typecheck`, `npm test`, and `npm run build` from `frontend/`. Test Chrome desktop plus a 360–390px mobile viewport, keyboard-only navigation, invalid submission, image add/remove, microphone permission fallback, successful mould report and tracking. Report only tests actually performed. Handoff with files changed, features, screenshots if taken, limitations, requested shared changes and commit hash. Do not commit shared files or merge branches.
