// Run from frontend/: node --test tests/map-focus.test.ts
// Node 24 strips TypeScript types natively, so no extra dependencies are needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { diffRoutes, routesFromPlan, type BackendPlan } from "../src/map-focus/planDiff.ts";
import { replanProgress, routeRenders, tripTimestamps, nextStopIndex } from "../src/map-focus/routeFocus.ts";
import { applyBasemapLabelRules, basemapLabelMinZoom, neighbourhoodLabelStyle, type MapLike } from "../src/map-focus/labelZoom.ts";

const sample = JSON.parse(readFileSync(new URL("../public/sample-plans.json", import.meta.url), "utf8"));

test("route diff matches the scheduler's own diff for the real sample re-plan", () => {
  const before = routesFromPlan(sample.before as BackendPlan);
  const after = routesFromPlan(sample.after as BackendPlan);
  const diff = diffRoutes(before, after);
  assert.deepEqual(diff.moved.map((m) => m.stopId).sort(), sample.diff.moved.map((m: { job_id: string }) => m.job_id).sort());
  assert.deepEqual(diff.added.map((a) => a.stopId), [sample.emergency_job.id]);
  assert.equal(diff.removed.length, sample.diff.dropped.length);
  // every worker that gained, lost or reordered stops is "changed"; that includes the emergency's worker
  assert.ok(diff.changedWorkers.includes(diff.added[0].to));
});

test("emergency absorbed with zero other moves still marks the receiving worker as changed", () => {
  const prev = { "w-1": ["j-1", "j-2"], "w-2": ["j-3"] };
  const next = { "w-1": ["j-1", "emergency", "j-2"], "w-2": ["j-3"] };
  const diff = diffRoutes(prev, next);
  assert.deepEqual(diff.moved, []);
  assert.deepEqual(diff.changedWorkers, ["w-1"]);
});

test("no routes by default; hover previews one; select focuses one", () => {
  const ids = ["w-1", "w-2", "w-3"];
  assert.deepEqual(routeRenders(ids, { now: 0 }), []);
  assert.deepEqual(routeRenders(ids, { now: 0, hoveredWorker: "w-2" }).map((r) => [r.workerId, r.mode]), [["w-2", "preview"]]);
  const focused = routeRenders(ids, { now: 0, selectedWorker: "w-1", showAll: true });
  assert.equal(focused.find((r) => r.workerId === "w-1")!.mode, "focus");
  assert.ok(focused.filter((r) => r.workerId !== "w-1").every((r) => r.mode === "dimmed"));
});

test("re-plan animates only changed workers, with the old route fading out, then stops", () => {
  const replan = { changedWorkers: ["w-2"], startedAt: 1000, durationMs: 5000 };
  const mid = routeRenders(["w-1", "w-2"], { now: 3500, replan });
  assert.deepEqual(mid.map((r) => [r.workerId, r.mode, r.plan]), [["w-2", "replan-old", "previous"], ["w-2", "replan-new", "current"]]);
  assert.ok(mid[0].dashed && mid[0].opacity < 0.6 && mid[1].animate);
  assert.equal(replanProgress(replan, 3500), 0.5);
  assert.deepEqual(routeRenders(["w-1", "w-2"], { now: 6000, replan }), []);
});

test("trip timestamps run 0..duration in path order", () => {
  const ts = tripTimestamps([[-1.47, 53.38], [-1.46, 53.38], [-1.46, 53.39]], 5000);
  assert.equal(ts[0], 0);
  assert.equal(ts[ts.length - 1], 5000);
  assert.ok(ts[1] > 0 && ts[1] < 5000);
  assert.equal(nextStopIndex(["2026-11-13T09:00:00Z", "2026-11-13T12:00:00Z"], new Date("2026-11-13T11:00:00Z")), 1);
});

test("neighbourhood labels thin out as you zoom out", () => {
  const major = { name: "City Centre", major: true };
  const minor = { name: "Netherthorpe" };
  assert.ok(neighbourhoodLabelStyle(14, major).visible && neighbourhoodLabelStyle(14, minor).visible);
  assert.ok(neighbourhoodLabelStyle(12, major).visible && !neighbourhoodLabelStyle(12, minor).visible);
  assert.ok(!neighbourhoodLabelStyle(9.5, major).visible);
  assert.ok(neighbourhoodLabelStyle(11, major).sizePx < neighbourhoodLabelStyle(14, major).sizePx);
});

test("basemap label rules set min zooms, fade and no overlap on symbol layers only", () => {
  const calls: string[] = [];
  const map: MapLike = {
    getStyle: () => ({ layers: [
      { id: "roads", type: "line" },
      { id: "road_label", type: "symbol", "source-layer": "transportation_name" },
      { id: "place_city", type: "symbol", "source-layer": "place" },
    ] }),
    setLayoutProperty: (id, name, value) => calls.push(`${id}.${name}=${JSON.stringify(value)}`),
    setPaintProperty: (id, name) => calls.push(`${id}.${name}`),
    setLayerZoomRange: (id, min) => calls.push(`${id}.minzoom=${min}`),
  };
  assert.deepEqual(applyBasemapLabelRules(map), ["road_label", "place_city"]);
  assert.ok(calls.includes("road_label.minzoom=15") && calls.includes("place_city.minzoom=9"));
  assert.ok(calls.includes("road_label.text-allow-overlap=false"));
  assert.equal(basemapLabelMinZoom({ id: "poi_label", "source-layer": "poi" }), 16.5);
});
