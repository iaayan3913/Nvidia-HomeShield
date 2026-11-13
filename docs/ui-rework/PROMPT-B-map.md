# Prompt B: the Sheffield twin map

Copy everything below the line into your coding agent.

---

You are working on HomeShield, a hackathon demo (NVIDIA Hack for Impact, Sheffield, today). It has a React + TypeScript + Vite frontend in `frontend/`, with a deck.gl and MapLibre map in the `TwinMap` component. Read `docs/ui-rework/README.md` first: it lists the shared rules, the backend API, and Step 0 (the frontend source must be committed before you start). Work on a new branch from `main`.

**You own:** the `TwinMap` component and everything drawn on the map: layers, layer toggles, map legend, map tooltips and popups, camera. **Do not change** the app layout or tabs (workstream A, which merges first, so rebase onto it) or the case list and cards (workstream C). Read live plan and worker data through workstream C's data layer once it lands; until then, use the existing mock data.

## Why

The map is the centrepiece the operator and the judges look at. Right now it is cluttered: every worker's full route is always drawn, a hotspots layer adds noise, and place labels pile on top of each other when you zoom out.

## Tasks

1. **Remove hotspots completely.**
   - The layer toggles include `hotspots`: delete the layer, its toggle (the "Hotspots" control) and any legend entry.
   - Remove its data generation if nothing else uses it.
2. **Routes on demand ("dynamic").** By default, draw **no full routes**. Show workers as small icons at their current position, plus their next stop.
   - Show a route only when it is relevant:
     - **Hover a worker:** a faint preview of their remaining route.
     - **Click a worker or a case:** that worker's full route for the day, highlighted. Everything else dims.
     - **Re-plan:** when a new plan arrives (a re-plan after an emergency), animate **only the routes that changed** for about 5 seconds, then let them fade. Draw the old route as a faded dashed line and the new one solid, so they are easy to tell apart. Use a TripsLayer or an animated PathLayer.
   - Keep a single "Show all routes" toggle for debugging, off by default.
   - Draw route paths along the roads if you have road geometry. Otherwise use straight segments between stops, which are fine at demo zoom.
   - To know which routes changed, compare `worker_id` → ordered `job_id`s between the previous and new plan. A job moving between workers means both routes changed.
3. **Labels that fade with zoom.**
   - Place and area labels must not overlap.
   - Below roughly zoom 12, hide street and minor place labels. Below roughly 11, show only area names. At city scale, show at most a handful.
   - In MapLibre, use symbol-layer `minzoom`, a zoom expression on `text-opacity`, and `text-allow-overlap: false`. In deck.gl `TextLayer`, use the `CollisionFilterExtension` and a zoom-dependent `getSize`/opacity.
   - Labels for selected or emergency properties may stay visible.
4. **Less text on the map.**
   - Tooltips: a single line (hazard · severity · deadline countdown). Details belong in workstream C's case panel.
   - Shrink the legend to colour swatches with one-word labels, collapsible.
5. **Live plan on the map.** In live mode, workers come from `GET /api/workers` and routes from the active plan (`GET /api/plans/active`, falling back to `/api/plans/latest`). Update on the SSE events `plan.activated`, `plan.replan_completed` and `plan.proposed`. A proposed but not approved plan must not replace the active routes; it may show as a dashed preview. Background jobs `j-001`…`j-036` are normal stops.
6. **Offline basemap fallback.**
   - The basemap currently loads tiles from `https://tiles.openfreemap.org`, which needs internet.
   - If the style or tiles fail to load (or a `VITE_OFFLINE_MAP=true` flag is set), fall back to a dark background with roads drawn from the local `frontend/public/roads-major.geojson` (5,425 real major roads, about 1.5 MB, committed) and buildings from `properties.geojson`.
   - Keep the © OpenStreetMap contributors attribution visible.
7. Keep existing behaviour that works well: severity colours from `docs/CONTRACTS.md` (emergency red and pulsing), property blocks whose height grows with urgency, fly-to on a new emergency, and the camera presets.

## Done means

- [ ] No hotspots layer, toggle or legend entry remains.
- [ ] Default view shows no full routes. Hover previews one worker, click highlights one, and the rest dim.
- [ ] After an emergency re-plan, only the changed routes animate, and old and new are clearly different. It still works when zero other jobs move (cuOpt often fits an emergency in without moving anyone): then only the receiving worker's route animates.
- [ ] Zooming out from street level to city level never shows overlapping labels.
- [ ] With Wi-Fi off, the map still shows Sheffield roads and properties.
- [ ] It still runs at a smooth frame rate on the operator laptop. `npm run build` passes with no TypeScript errors.

When you finish, report what you changed, before-and-after screenshots if you can, and anything left for A or C.
