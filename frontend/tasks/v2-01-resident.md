# Round 2 · Agent 1: Resident app (tenant-facing, phone first)

You are improving the HomeShield **Resident** experience: the product a tenant uses on a phone, tablet or laptop to report a problem with their home and follow its progress. The current four-step report flow and tracking view already exist in `frontend/src/portals/resident/`. Improve them; do not rewrite from scratch.

**Before you start**, read `frontend/tasks/v2-00-shared-contract.md` (binding), `frontend/DESIGN_SYSTEM.md` and the existing resident code and tests. Create branch `frontend-v2/resident` from the latest `main`. You may edit only `frontend/src/portals/resident/**`.

## Feedback this round must resolve

1. Light and dark mode on every screen.
2. It must read as a real service, not a fictional demonstration.
3. The resident side runs on a separate device (usually a phone). A report sent from the phone must arrive on the staff laptop.

## 1. Theme

- Every resident screen works in both `data-theme="light"` and `data-theme="dark"`. Replace any hard-coded colours or light-only assumptions in `resident.css` and components with semantic tokens and `color-mix()`.
- Check WCAG 2.2 AA contrast in both themes: text, focus rings, error states, the emergency strip, step indicator, photo thumbnails and the confirmation reference card.
- Until Platform's theme toggle is merged, test by setting `document.documentElement.dataset.theme` in devtools. Do not build your own global toggle.

## 2. Real-service language

- Remove demonstration framing, including:
  - "Resident portal · demonstration"
  - the "About this demonstration" panel
  - "a fictional number is fine"
  - "Choose one of the fictional demonstration homes"
  - "This is a demonstration: a simulated report and case were created in this browser"
- Write plain, calm, British English copy for a real housing repair service. Add a short privacy note: what is shared with the housing team, why the phone number is needed, and that photos and voice notes go to the repairs team only.
- Show the contract's "Test mode" indicator only when `useConnection().simulatedServices` is true.
- Keep the triage result advisory ("Our automated check suggests…; a housing officer will confirm the priority"). Never promise a statutory deadline. Keep the 999 and 0800 111 999 safety guidance prominent but calm.

## 3. Finding the home

- Replace the fixed "Property" dropdown with a "Find your home" step: a postcode or address search that calls `await mockService.findProperties(query)`, an accessible results list (keyboard and screen-reader friendly), and a clear chosen-address summary.
- Add a "My address isn't listed" path. It captures `address_line` and `postcode` (loose UK postcode validation with a helpful error) and submits them through the contract's `CreateReportInput` fields.
- Until Platform merges, the `findProperties` stand-in filters `useDemoState((s) => s.properties)` locally.

## 4. Submitting from a phone to the laptop

- `await` every service call. While submitting, disable the submit button and guard against double submission, including rapid double taps.
- On failure (offline, server error, timeout), keep the draft in session storage, show what happened in plain language, and offer a retry. Never show the confirmation unless the backend accepted the report.
- **Photos:** use `<input type="file" accept="image/*" capture="environment">` so phones offer the camera. Send at most one photo and one voice note (`photo` / `audio` Blobs in `CreateReportInput`). If someone selects more, explain that only one is sent. Downscale large phone photos client-side (for example to 2048 px on the long edge, JPEG/WebP) to stay under the 10 MiB limit, without blocking the UI.
- **Voice notes:** check `window.isSecureContext`. On an insecure origin, hide recording and explain that voice notes need a secure connection; text and photos still work. Handle permission denial gracefully (this exists; keep it).
- **Confirmation:** show the reference, what happens next, and a "Track this report" action. The device remembers references it submitted (session storage already exists; keep that behaviour).

## 5. Tracking

- Use the contract's `useTrackedCase(reference)` (stand-in until Platform merges). Status updates arrive live without a reload: received → being reviewed → visit scheduled → operative on the way → on site → completed or unable to complete.
- Show only resident-safe information: no other residents' cases, no internal notes and no operative surname.
- Handle the `loading`, `not_found` and `error` states, with a retry where it makes sense.

## 6. Devices and responsiveness

- Primary: phones from 320 to 430 px wide, in portrait and landscape. Also support tablets (768, 1024) and laptops (1280+).
- 44 px minimum touch targets. Inputs must not trigger iOS zoom (16 px or more). Use sensible `inputmode` and `autocomplete` values. Behave well with the on-screen keyboard open, and keep step actions reachable.
- No horizontal scrolling at any width. Respect `prefers-reduced-motion`.

## 7. Accessibility

Keep and verify the following:

- an error summary with links to the fields in error
- step headings that receive focus on step change
- labelled controls and the status announcement after submission
- full keyboard-only completion of the whole flow
- status never shown by colour alone

## Tests

- Update the existing unit and component tests to cover:
  - the async service with a pending state and an error
  - address search, including the not-listed path
  - double-submit protection
  - tracking state transitions
- Browser checks in both themes at 390×844, 360×740, 768×1024 and 1440×900, using device emulation.
- If Platform's two-app setup is merged in your checkout: submit a report from a real phone on the same Wi-Fi and confirm it appears in Operations on the laptop. If not, say that the two-device test is pending integration.

## Handoff

Follow the contract's definition of done. Also list any copy you were unsure about, any backend fields you need (for example a structured address on the case), and any stand-ins the integrator must remove.
