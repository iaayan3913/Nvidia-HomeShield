/**
 * Workstream B map helpers: route diffing, routes-on-demand rules and zoom-aware labels.
 * Pure TypeScript (no React, deck.gl or MapLibre imports) so it can be unit-tested with
 * `node --test tests/map-focus.test.ts` (from frontend/) and wired into TwinMap once the dashboard source is in git.
 * See docs/ui-rework/PROMPT-B-map.md for how TwinMap uses these.
 */
export * from "./planDiff";
export * from "./routeFocus";
export * from "./labelZoom";
