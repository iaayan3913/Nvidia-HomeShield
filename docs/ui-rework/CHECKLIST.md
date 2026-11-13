# UI rework checklist

Times are targets for today, 13 Nov. The 16:00 feature freeze from `PLAN.md` still applies. Owners: **A = Enan**, **B = Aayan**, **C = Person C** (replace with their name).

| Workstream | Owner | Items | Done |
|---|---|---:|---:|
| Step 0: source in git | Enan (A) | 3 | 0 |
| A: shell, tabs, resident report | Enan | 8 | 0 |
| B: map | Aayan | 7 | 0 |
| C: cases, text, status, data layer | Person C | 7 | 0 |
| Shared gates | all | 4 | 0 |

## Step 0: blocking (as soon as possible)

- [ ] **[Enan (A)]** Find the dashboard source on his laptop and commit it to `frontend/`: `src/**`, `vite.config.*`, `tsconfig*`, `package.json` and `package-lock.json` (with maplibre-gl, @fontsource and React 19), mock data. Done when it is merged to `main`.
- [ ] **[Enan (A)]** A clean clone builds (`npm ci && npm run build`), and `npm run dev` shows the same dashboard as `npm run mock`. Done when Aayan or Person C confirms it on their own laptop.
- [ ] **[Enan, Aayan, Person C]** Each owner branches from that commit. Done when all three branches exist.

## A: shell, tabs and resident report

- [ ] **[A | +45 min]** Routes `/` (operator) and `/report` (resident). Resident report removed from the dashboard. Done when the layout PR is opened.
- [ ] **[A | +45 min]** Twin and Schedule tabs; "Today's schedule" moved into the Schedule tab. Done when it is hidden by default.
- [ ] **[A | +45 min]** Agent activity as a header drawer with an unread count. Done when it is hidden by default. **Merge the layout PR here; B and C rebase onto it.**
- [ ] **[A | 14:30]** Mobile-first `/report`: text, camera photo, property picker, success and error states. Done when it works on a phone.
- [ ] **[A | 14:30]** Live submission to `POST /api/reports` (multipart with photo); mock success when there is no backend. Done when a phone report reaches the backend.
- [ ] **[A | 14:30]** Vite `server.host` and an `/api` proxy (including SSE) to `HOMESHIELD_API`. Done when another device loads the dashboard through Laptop 2.
- [ ] **[A | 15:00]** `docs/DEMO_DEVICES.md`: device roles, commands, IPs, hotspot fallback, QR link. Done when tested with one phone.
- [ ] **[A | 16:00]** Rebuild and commit `frontend/mock-build/` once at freeze. Done when `npm run mock` shows the new UI.

## B: map

- [ ] **[B | +30 min]** Remove the hotspots layer, toggle and legend entry. Done when nothing hotspot-related remains.
- [ ] **[B | 13:45]** Zoom-aware labels (minzoom, opacity by zoom, no overlap). Done when zooming from street to city level shows no overlapping text.
- [ ] **[B | 14:15]** No full routes by default: hover previews one worker, click highlights one, the rest dim. Done when the default view is uncluttered.
- [ ] **[B | 14:15]** Single-line tooltips; compact, collapsible legend. Done when the map shows no paragraph text.
- [ ] **[B | 15:00]** Re-plan animation of only the changed routes (old dashed and faded, new solid). Done when the demo emergency animates, including the case where 0 other jobs move.
- [ ] **[B | 15:00]** Live workers and active plan from C's data layer; a proposed plan shows only as a preview. Done when a live re-plan redraws the map.
- [ ] **[B | 15:30]** Offline basemap fallback using `roads-major.geojson` and `properties.geojson`. Done when the map works with Wi-Fi off.

## C: cases, text, status and data layer

- [ ] **[C | +45 min]** Shared live data layer (`src/lib/live.ts`): mock and live modes, REST plus named SSE events, reconnect. Done when A and B can import it.
- [ ] **[C | 14:00]** New collapsed case card: severity, hazard, area, deadline countdown, status, worker plus ETA. Done when no card has paragraph text.
- [ ] **[C | 14:00]** Urgency sort and an all / emergency / awaiting / scheduled filter. Done when emergencies are always on top.
- [ ] **[C | 14:15]** Shared case selection with the map (agree it with B). Done when clicking a card highlights the house and its route.
- [ ] **[C | 14:30]** Header counters as four compact numbers; text cut across the dashboard; relative times. Done when no sentence is over about 10 words.
- [ ] **[C | 14:30]** Schedule tab trimmed to one row per worker. Done when it fits on one screen.
- [ ] **[C | 15:00]** "PLAN vN" replaced by "Schedule updated HH:MM" plus a re-plan toast (solver · time · visits moved · deadlines). Done when the demo emergency shows "cuOpt" and its time.

## Shared gates

- [ ] **[All | 15:00]** Phone `/report` → case on the operator dashboard → approval → schedule → map, all live. Done when it works end to end.
- [ ] **[All | 15:30]** Demo emergency → re-plan toast → changed routes animate. Done when it works on the Spark backend with `SCHEDULER_ADAPTER=cuopt`.
- [ ] **[All | 16:00]** Feature freeze, refreshed `mock-build`, and the offline backup laptop tested.
- [ ] **[All | 16:00]** The team agrees the demo emergency (gas leak in the pitch script, or the electrical socket from the intake demo photos) and the pitch and demo match.
