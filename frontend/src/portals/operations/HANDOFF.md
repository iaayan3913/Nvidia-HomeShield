# Operations round 2: handoff

Branch: `Aayan-v2-02`. Task: `frontend/tasks/v2-02-operations.md`. I edited only owned paths: `frontend/src/portals/operations/**`, `scripts/fetch-sheffield.py` and `frontend/public/data/**`.

## Why the map wasn't visible

Earlier in the same session, on the team laptop, the Vite server on port 5173 kept running through an `npm install`. It then answered "504 Outdated Optimize Dep", so the lazy-loaded 3D chunk failed to load and the portal dropped to the 2D schematic. Even when the 3D view did load, it showed only a background colour, synthetic straight "roads" (`roads-major.geojson`) and hexagon prisms, so it looked empty.

Fixes:

- The real basemap (below).
- A distinct message when a code chunk fails to load (it suggests `npm run dev -- --force`).
- "Try 3D again" from the 2D view and the Layers tab.
- `roads-major.geojson` and `properties.geojson` are no longer used.

Not done: I didn't re-run the stale-server scenario on another team machine. The cause above is from the logs observed in this session.

## What changed

- **Basemap:**
  - OpenFreeMap vector tiles (TileJSON `https://tiles.openfreemap.org/planet`, glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`, font `Noto Sans Regular`). I verified these by fetching them on 2026-11-13.
  - The attribution text comes from the TileJSON: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", with links.
  - The style is built in code (`map/basemap.ts`). A theme change calls `setPaintProperty` only; measured at 0 tile requests when switching dark → light → dark.
- **Overlay:** a single interleaved deck.gl `MapboxOverlay`.
  - Compatibility shim: deck.gl 9.4 interleaved reads `map.transform.height`, which MapLibre 6.18 no longer exposes at runtime. `TwinMap.tsx` defines only that getter on its own map instance.
  - Without the shim the overlay threw `Cannot read properties of undefined (reading 'height')` on every frame.
- **Local/offline data:** `frontend/public/data/sheffield-{buildings,roads,places}.geojson` are used as MapLibre GeoJSON sources with the same styling.
  - **Automatic mode** uses tiles when they load and switches to local files when tile requests fail or the device is offline.
  - **Manual choice:** Layers → Map data.
  - The active source is shown in the attribution line.
- **Buildings at true scale:**
  - Heights come from `render_height`/`render_min_height` (tiles) or `height`/`min_height` (local data), with a 6 m default. There is no zoom term.
  - I removed `markerScale()`, the cause of the "buildings shrink as you zoom in" bug.
  - Case shells, hazard columns (9 m radius) and markers are all fixed metric sizes.
- **deck.gl layers** (each toggleable, one legend):
  - Case buildings by severity: matched to a footprint (point-in-polygon, else nearest within 40 m; otherwise an "approximate location" marker).
  - Glowing hazard columns by hazard type.
  - Hexagon density (off by default; binning in `lib/geo.ts`, no new dependency).
  - Operatives, solid approved routes and dashed pending routes, with a re-plan morph animation.
  - Neighbourhood labels (MapLibre `place` labels online, decluttered deck labels offline).
- **Interaction:**
  - Hover tooltips.
  - Clicking on the map or selecting from the list flies the camera with a short `easeTo` (instant under reduced motion).
  - Pan, zoom, rotate, tilt, north-up, show-all-cases and reset (central Sheffield) controls, plus MapLibre keyboard controls.
- **Layout:**
  - Left collapsible panel with Cases and Layers tabs.
  - Right collapsible panel with Details and Activity tabs.
  - A stats overlay with a LIVE / Connecting / Offline / Local data indicator, from `useConnection()`.
  - A collapsible schedule drawer under the map, with a mandatory review checkbox and Approve / Reject-with-reason.
- **2D fallback:** a canvas map of the same local roads, buildings, cases, operatives and routes.
  - Pan by drag, zoom by wheel and pinch, arrow keys, `+`/`-`/`0`, zoom buttons and reset, plus click-to-select. Themed.
- **Theme:** every colour is a CSS token in `operations.css` (`--map-*` per theme), read at runtime by `lib/palette.ts`. There are no colour literals in TS or CSS.
- **Language:**
  - I removed the "fictional", "synthetic housing stock" and "demonstration" chrome.
  - "Test mode", the solver's "simulated" label and the Simulate-emergency button appear only when `simulatedServices` is true. Reset appears only when `canReset` is true.
  - Triage is labelled as an advisory suggestion.
- **Async:** every `mockService` call is awaited, with busy states and an error message that offers a retry.

## Data files (generated 2026-11-13)

`py -3.13 scripts/fetch-sheffield.py --source openfreemap` gives 3.5 km around 53.3811, −1.4701 for buildings and roads, and 7 km for places:

| File | Features | Size |
|---|---|---|
| `sheffield-buildings.geojson` | 40,897 | 11.0 MB |
| `sheffield-roads.geojson` | 9,226 | 1.9 MB |
| `sheffield-places.geojson` | 160 | 24 KB |

The Overpass source (the default) wasn't reachable from this network: overpass-api.de connections timed out, the maps.mail.ru mirror returned 504 even for one 1.4 km tile, and kumi timed out. That's why I added `--source openfreemap`, which decodes the same OpenStreetMap data from OpenMapTiles z14 vector tiles using only the standard library. When Overpass is reachable, use `py -3.13 scripts/fetch-sheffield.py` (optionally `--endpoint …`, `--tiles N`).

Each file's `metadata` carries the ODbL / OpenFreeMap attribution. All files are under 25 MB, so I've committed them.

## Tests performed

**Commands** (from `frontend/`): `npm run typecheck` passes; `npm test` gives 55/55 across 8 files (34 of them in operations); `npm run build` passes.

**Browser:** headless Chromium (Playwright, SwiftShader WebGL2) against a dev server on port 5199. All checks passed:

- Online: 34 OpenFreeMap tile requests and the attribution is shown.
- Theme switch causes no tile requests, and panels recolour (white in light mode).
- List selection flies to HS-26041 (zoom 16.2) and the details stay in sync.
- The building height expression has no zoom term; I compared screenshots at z14.5 and z17.5.
- The hover tooltip shows the case reference.
- A map click selects the case.
- Every layer toggle works, the density layer renders, and the local-files source works.
- Offline (all external hosts blocked): auto mode falls back to local files.
- WebGL disabled: the 2D view pans by drag, zooms by wheel, and responds to keyboard pan/zoom (verified by canvas pixel changes).
- Proposal: Approve is disabled until reviewed, rejection keeps the active plan, approval activates the new plan.
- Emergency: exactly one case and re-plan are created; a repeat click doesn't duplicate them; the activity entry appears; approving makes `plan-emergency-replan` active.
- Reset returns to the baseline and the camera returns to central Sheffield.
- Both panels collapse and reopen.
- No horizontal overflow at 1280×800, 1440×900, 1920×1080 or 1024×768.

**Console:**

- No application errors.
- SwiftShader logs "GPU stall due to ReadPixels" while picking (a software-GL performance notice).
- With external hosts blocked, two `ERR_INTERNET_DISCONNECTED` lines: the global Google Fonts import and the tile probe before falling back.

**Not tested:**

- Real GPU browsers.
- Real phones.
- Screen readers.
- The two-device SSE flow (needs the Platform merge).
- The stale-server reproduction on another team machine.

## Stand-ins to remove after the Platform merge

- `hooks/connection.ts`: switches to the shared `useConnection` automatically when it's exported.
- The `useThemeName()` stand-in in `hooks/environment.ts`: it only sets `data-theme` when the attribute is missing.
- The `CONTRACT-STANDIN` block at the top of `operations.css`: light surface tokens that override the forced-dark `[data-portal="operations"]` rule.

## Limitations

- **Case locations are approximate.** The fixture/register coordinates mostly don't sit on real buildings: the nearest footprint to p-002 is about 70 m away, to p-110 about 118 m, and several properties are outside the 3.5 km local radius. So cases show as "approximate location". A real property register with real coordinates will snap onto buildings.
- **Offline labels shrink with distance.** In the pitched local/offline view, distant deck.gl neighbourhood labels render smaller (a deck.gl interleaved perspective effect); `sizeMinPixels` had no effect. Online labels are MapLibre symbols and are unaffected.
- **Seams in tile-decoded buildings.** Buildings from tile decoding can be split at z14 tile boundaries.
- **Approval replaces the whole plan.** This comes from the shared mock; the UI warns with "Not carried into this proposal".
- **Dev-only map handle.** `window.__homeshieldTwin` exists only in Vite development builds, for automated checks.

## Requested shared changes

1. **Platform:** remove the forced-dark `[data-portal="operations"]` overrides in `global.css`, and theme the toast region and topbar (the "Demo data" chip in `PortalNav` still reads as a demo).
2. **Platform:** self-host fonts so offline use doesn't log a failed Google Fonts request.
3. **Platform/backend:** provide a property register with real coordinates (or a geocoded address) so cases land on their buildings.
4. **Platform:** retire `public/roads-major.geojson` and `public/properties.geojson` (no longer used by Operations).
5. **Shared mock/backend:** make `approveProposal` merge with existing active assignments rather than replacing them.
