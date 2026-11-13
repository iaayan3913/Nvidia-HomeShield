# UI rework (13 Nov, afternoon)

Operator feedback on the dashboard, split into three parallel workstreams. Each workstream has its own agent prompt; [CHECKLIST.md](CHECKLIST.md) tracks all three.

| Workstream | Prompt | Owns |
|---|---|---|
| A: Shell, tabs and resident report | [PROMPT-A-shell-and-resident-report.md](PROMPT-A-shell-and-resident-report.md) | App layout and navigation, Schedule tab, Agent activity drawer, `/report` page for phones, device and network setup |
| B: Map | [PROMPT-B-map.md](PROMPT-B-map.md) | Twin map layers: hotspots removed, routes on demand, zoom-aware labels, live plan on the map, offline basemap fallback |
| C: Cases, text and status | [PROMPT-C-cases-and-declutter.md](PROMPT-C-cases-and-declutter.md) | Case list and cards, header and counters, replacing "PLAN vN", live data layer (cases, plans, events) |

## Step 0, blocking everyone: commit the frontend source

`main` only contains the **compiled** dashboard (`frontend/mock-build/`). Its source (the `TwinMap` component, `src/lib/theme.ts`, the mock data and so on) has never been committed: `frontend/src/` still holds the 14-line starter `main.tsx`. Nobody can change the UI until the source is in git.

The author of the "web done" commit (Enan) should:

1. Commit the full frontend source: everything under `frontend/src/`, plus `vite.config.*`, `index.html`, `public/` assets and any mock-data files. Leave out `node_modules/` and `dist/`.
2. Check that `npm install && npm run dev` in `frontend/` shows the same dashboard as `npm run mock`.
3. Merge to `main` and tell the team. All three workstreams branch from that commit.

## Rules for all three workstreams

- **Stay in your own components.** If you need a change in another workstream's file, ask its owner, or make the smallest possible edit and say so in your PR.
- **Merge order:** A's layout restructure merges first. B and C build their components in parallel and rebase onto A once it lands.
- **Find code by its on-screen text.** The prompts name strings the current UI shows ("Today's schedule", "Agent activity", "Resident report", "Hotspots", "PLAN v", "Re-planned"). Search the source for them.
- **Keep mock mode working.** The dashboard must still run with no backend, using the demo data. Live mode is enabled by setting an API URL.
- **Do not commit `frontend/mock-build/` while working.** It is a build output. Workstream A regenerates it once at feature freeze.
- **Shared colours** come from `docs/CONTRACTS.md`: emergency `#ef4444`, significant `#f97316`, moderate `#eab308`, routine `#9ca3af`, scheduled `#3b82f6`, resolved `#22c55e`.
- **The backend is authoritative.** API and SSE event names are in `docs/CONTRACTS.md` and `docs/BACKEND_INTEGRATION.md`. Tolerate unknown fields and new enum values.

## Backend facts you will need

- REST: `POST /api/reports` (JSON, or multipart with `photo`/`audio` files), `GET /api/cases`, `GET /api/plans/active`, `GET /api/plans/latest`, `GET /api/workers`, `GET /api/approvals`, `POST /api/approvals/{id}/approve|reject`, `POST /api/emergency`, `GET /api/stream` (SSE).
- SSE uses named events. Listen with `addEventListener(type, …)`, not only `onmessage`. Types include `case.created`, `case.status_changed`, `plan.proposed`, `plan.replan_started`, `plan.replan_completed`, `plan.approved`, `plan.activated` and `approval.requested`.
- A `Plan` has `id`, `solver`, `solver_ms`, `workers[].stops[]` (`job_id`, `eta`, `lat`, `lon`, `slack_minutes`), `unassigned_jobs`, `conflicts` and `approved`. Plans have **no version number**.
- Seeded background jobs `j-001`…`j-036` appear in plans but have no case in `/api/cases`. Render them as ordinary workload.
- Property ids in `frontend/public/properties.geojson` run `p-001`…`p-400`. Send real ids so the right house lights up.
