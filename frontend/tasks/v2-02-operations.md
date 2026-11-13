# Round 2 · Agent 2: Operations dashboard and Sheffield digital twin (staff, laptop/PC)

You are rebuilding the HomeShield **Operations** dashboard around a real 3D digital twin of Sheffield. Housing officers use it on a laptop or PC to see cases, review automated schedule proposals, approve or reject them, and handle emergencies.

**Before you start**, read `frontend/tasks/v2-00-shared-contract.md` (binding), `frontend/DESIGN_SYSTEM.md` and the existing code in `frontend/src/portals/operations/`. Keep its tested workflow logic (`lib/derive.ts`, approval and emergency flows, the human-review gate); replace the map and layout. Create branch `frontend-v2/operations` from the latest `main`. You may edit only:

- `frontend/src/portals/operations/**`
- `scripts/fetch-sheffield.py`
- `frontend/public/data/**`

## Feedback this round must resolve

1. Light and dark mode.
2. "We cannot see the map." The twin must clearly be Sheffield: real streets, real buildings and real place names. The basemap is OpenFreeMap (attribution: OpenFreeMap © OpenMapTiles Data © OpenStreetMap; verify the exact wording and links on openfreemap.org).
3. It must read as a real operations tool, not a fictional demonstration.
4. Zooming in makes the buildings smaller. Buildings must look like buildings at every zoom.
5. The 2D schematic cannot be panned or zoomed.
6. This dashboard runs on the staff laptop and must show reports sent from a resident's phone, live.

## 0. Diagnose first, and report what you find

The last build rendered in headless Chrome, but the team saw the 2D schematic. Reproduce on a team machine and record the real cause in your handoff. Likely causes:

- **Stale bundled dependencies.** After an `npm install`, a still-running Vite server answers "504 Outdated Optimize Dep", the lazy `TwinMap` chunk fails to load, and the portal falls back to 2D. Restart with `npm run dev -- --force`.
- **WebGL2 unavailable** or blocklisted. Check `chrome://gpu`.
- **A map that loads but looks empty.** The current twin draws only a background colour, synthetic straight-line "roads" (`roads-major.geojson`) and hexagon prisms.

Make every failure path explicit in the UI: the reason, a "Try 3D again" action, and a distinct message when a code chunk fails to load. Retire `roads-major.geojson` as a road layer; it is synthetic straight links, not roads.

## 1. Map architecture

- **One renderer stack.** Use MapLibre GL with a single **interleaved** deck.gl `MapboxOverlay` (`interleaved: true`), so deck.gl layers depth-sort correctly with extruded buildings. The portal already uses MapLibre and deck.gl; there is no Leaflet to remove.
- **Basemap style built in code from theme tokens.**
  - Source: OpenFreeMap vector tiles (OpenMapTiles schema; TileJSON at `https://tiles.openfreemap.org/planet`; verify the URL and any glyph/font endpoint before relying on them).
  - Layers: background, land/landuse/parks, water, roads by class, building `fill-extrusion`, and place labels.
  - Switching between dark and light only recolours existing layers (`setPaintProperty`). It must never call `setStyle` or refetch tiles; verify in the network panel.
  - deck.gl and the map read colours from CSS variables at runtime and re-read them when `data-theme` changes. Components contain no hex values. Map tokens such as `--map-water`, `--map-road` and `--map-building` may live in `operations.css` under each theme, derived from global tokens where possible.
- **Local and offline data.**
  - When `frontend/public/data/sheffield-buildings.geojson`, `sheffield-roads.geojson` and `sheffield-places.geojson` are present, use them as MapLibre GeoJSON sources with the same styling. This also covers the offline case.
  - Decide online/offline from real tile-load success or failure, not only `navigator.onLine`. Show which source is active in the attribution area.
  - The existing MapLibre worker URL setup must keep working with GeoJSON sources.
- **Buildings at true scale.**
  - Extrude by metres: `render_height`/`render_min_height` from the tiles, or `height`, or `building:levels × 3 m` from local data, defaulting to 6 m. Use `elevationScale` 1.
  - Nothing about buildings or case markers may scale with zoom. The current bug is `markerScale()` in `map/layers.ts`: it shrinks footprint radius and drops height exaggeration from 9× to 1× as you zoom in. Remove it.
  - Acceptance: zooming from 12 to 18 makes buildings visibly larger, with real footprints.

## 2. deck.gl layers (each toggleable, all in one legend)

- **Case buildings highlighted by severity.**
  - Match each case's property latitude/longitude to its building footprint: point-in-polygon on local GeoJSON, or `querySourceFeatures` on the tile building layer near the point.
  - Extrude the matched footprint in the severity colour.
  - If no footprint is found, draw a small metric marker labelled "approximate location".
- **Glowing hazard columns** coloured by hazard type above case buildings. Use a constant metric radius (about 8–12 m) so they behave like physical objects; add the glow with translucency or additive blending.
  - In deck.gl 9.4, `ColumnLayer` logged luma.gl buffer-layout warnings. Verify a clean console or use `SolidPolygonLayer`.
  - Hazard colours are tokens. Every hazard is also named in the legend and tooltip, never colour alone.
- **Hexagon density layer**, off by default. Implement the binning in your directory; do not add a dependency (request `@deck.gl/aggregation-layers` from Platform only if you must).
- **Operatives and routes.** Approved routes are solid; pending proposals are dashed and clearly marked pending. Keep the re-plan morph animation when a proposal is approved.
  - Routes are ordered stop sequences. Draw them as schematic links and say so; do not fabricate turn-by-turn navigation.
- **Neighbourhood labels** for Sheffield suburbs and neighbourhoods: tile `place` features when online, and `sheffield-places.geojson` when local.

## 3. Interaction

- Hover tooltips on cases, hazard columns, operatives and stops.
- Clicking a case on the map, or selecting it from the list, flies the camera to it: short and direct, never zooming out and back in. Reduced motion means an instant jump.
- Selection stays synchronised between the map, list and details panel.
- Keep pan, zoom, rotate, tilt, north-up and reset-view controls with keyboard equivalents.
- Initial view frames central Sheffield with real buildings visible in 3D.

## 4. Layout (laptop/PC primary)

- The map fills the main area.
- **Left panel** (collapsible) with tabs: Cases (search, urgency/status filters, list) and Layers (toggles plus legend).
- **Right panel** (collapsible) with case details and agent activity: human-readable summaries from shared activity, never model reasoning.
- **Stats overlay** on the map replaces the KPI strip: open cases, emergencies, jobs due soon, operatives free.
  - It includes a LIVE indicator driven by `useConnection()`: "Live" only when `status === 'live'`, otherwise "Connecting…", "Offline" or "Local data".
- **Schedule drawer** under the map (collapsible). It compares the active plan with the newest proposal and holds the mandatory review checkbox plus Approve / Reject-with-reason controls.
- Target viewports: 1280×800, 1440×900 and 1920×1080. 1024×768 must remain fully usable. Phones are not a target, but nothing may break or overflow.

## 5. 2D fallback that you can actually use

When WebGL2 is unavailable, the 2D view must support:

- pan by drag
- zoom by wheel, pinch, and +/− buttons
- keyboard arrows and +/−
- reset view
- clicking markers to select

It must keep the selection in sync and follow the theme. It should render the same local roads, buildings (2D outlines) and cases.

## 6. Data and the two-device flow

- `await` every `mockService` call. Disable controls while pending and show errors with a retry. Approval must stay impossible until the reviewer ticks the review checkbox.
- New reports arrive through `useDemoState` (SSE in `api` mode). Show a "New report" notice with a Locate action, as today.
- Show Reset only when `useConnection().canReset`.
- Real-service language:
  - Remove "fictional", "synthetic housing stock" and "demonstration" chrome.
  - Keep licence attribution visible: OpenFreeMap / OpenMapTiles / OpenStreetMap, plus any local-data source.
  - Label solver output "simulated" only when `simulatedServices` is true. Otherwise name the solver from the plan.

## 7. `scripts/fetch-sheffield.py`

- Pulls OSM buildings, roads and place labels from the Overpass API for a configurable centre and radius (default: Sheffield city centre, 53.3811, −1.4701, radius 3.5 km). It writes compact GeoJSON to `frontend/public/data/`.
- Use the Python standard library (or packages already in `requirements.txt`). Send one bounded query per layer with a descriptive User-Agent, a timeout and retry with backoff. Round coordinates to 6 decimal places. Keep only the properties needed: height, levels, building type, name, highway class, place type.
- Print feature counts and file sizes. If a file exceeds about 25 MB, do not commit it: request a `.gitignore` entry from Platform and document how to regenerate it.
- Include the ODbL attribution note in each file's `metadata`.

## 8. Performance

- Render bulk buildings with MapLibre `fill-extrusion` (GPU), not one deck.gl object per building. Use deck.gl for case highlights, columns, density, routes and operatives.
- Memoise layers. Pointer movement must not rebuild data. Aim for smooth interaction at 1440×900 on a typical laptop.
- Clean up the map and overlay on unmount.

## Tests

- Unit tests: footprint matching, height extraction, hex binning, 2D pan/zoom maths, theme palette reading, and the existing derivation tests (keep them passing).
- Browser checks, in both themes, at the listed viewports:
  - online with OpenFreeMap
  - offline with local GeoJSON
  - toggling the theme causes no new tile requests
  - zooming from 12 to 18 makes buildings grow
  - hover, click and list selection fly the camera to the case
  - each layer toggle works
  - the WebGL-disabled 2D fallback pans and zooms
  - proposal review, approve, reject and emergency all work
  - the console is clean
- Two-device check (once Platform is merged): submit a report from a phone and confirm it appears here, live, within about 2 seconds. If you could not test it, say so.

## Handoff

Follow the contract's definition of done. Also include:

- the diagnosed cause of the invisible map
- the data files generated, with sizes and feature counts
- the exact OpenFreeMap endpoints and attribution used, and how you verified them
- the stand-ins to remove
- requested shared changes
