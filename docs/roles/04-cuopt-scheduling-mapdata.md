# Person 4 — cuOpt, scheduling and map data

## Goal and ownership

Own worker/job fixtures, travel data, `Scheduler`, cuOpt/OR-Tools fallback, properties, and roads. Do not build API or UI.

## Commands

```powershell
py data/generate_properties.py        # 400 properties -> data/generated + frontend/public/properties.geojson
py data/generate_synthetic.py         # 8 workers, 36 jobs -> data/generated/{workers,jobs}.json
py data/export_roads_geojson.py       # OSMnx roads, or labelled synthetic fallback -> frontend/public/roads.geojson
py data/build_travel_matrix.py        # OSMnx travel times, or labelled haversine fallback
py -m scheduler.mock                  # sample Plan + validation
py -m scheduler.benchmark --export    # before/after gas emergency for every solver -> frontend/public/sample-plans.json
py -m pytest scheduler/tests -q
```

On Spark, `py` becomes `python3`; test cuOpt separately with `python3 -m scheduler.cuopt` (prints import status, then solves the fixtures). `VERIFY:` aarch64 installation and exact cuOpt API. If it fails, keep the same `Scheduler` interface and use OR-Tools or the deterministic mock.

## Contract and checkpoints

Return ordered stops, ETAs, slack, unassigned jobs, conflicts, solver name, and milliseconds. At 13:00 a mock Plan is accepted by the API; at 15:00 an urgent job produces a measured revised Plan. Done means the demo never blocks on a solver.

## Checklist

- [x] Eight workers and at least 30 jobs are generated (36, deterministic, seed 44).
- [x] 300-500 properties and local road GeoJSON are available (400 properties; roads = synthetic fallback until OSMnx runs).
- [x] Travel matrix has an OSMnx path or labelled haversine fallback (`haversine_x1.3_at_25kmh`).
- [ ] cuOpt status is recorded on the Spark (`python3 -m scheduler.cuopt`).
- [x] OR-Tools/mock fallback has identical inputs and outputs.
- [x] Emergency re-plan reports solver time and conflicts.

## How it fits together

| Module | What it does |
|---|---|
| `scheduler/core.py` | Solver-independent model: integer-minute problem, ETA/slack simulation, `build_plan`, `validate_plan`, warm-start `replan`, `diff_plans` |
| `scheduler/mock.py` | Pure-Python greedy insertion with priority bumping; never fails |
| `scheduler/ortools.py` | OR-Tools VRPTW (skills, shifts, windows, priority drop penalties, warm start) |
| `scheduler/cuopt.py` | cuOpt adapter (`VERIFY:` API on Spark); same outputs |
| `scheduler/__init__.py` | `get_scheduler()` → fallback chain cuOpt → OR-Tools → mock |
| `scheduler/service.py` | `SchedulingService`: stateful facade for the backend + demo clock |
| `scheduler/fixtures.py` | fixture loaders, `case_to_job`, `demo_emergency_job` |
| `scheduler/travel.py` | travel-time model (precomputed matrix, else haversine × 1.3 at 25 km/h) |
| `data/sheffield.py` | district centroids, park exclusion zones (`VERIFY:` approximate) |

Conventions: naive UTC datetimes; `Job.latest` = latest arrival; higher `priority` = more urgent (routine 1, moderate 2, significant 3, emergency 5); `slack_minutes` = minutes between ETA and the job's deadline (`null` when the job has no deadline). Solvers only choose assignment and order — ETAs, slack and conflicts are always recomputed by `core.build_plan`, so every solver's Plan means the same thing.

## Handoff: Person 3 (backend)

```python
from scheduler.service import SchedulingService
scheduling = SchedulingService()          # create once at startup
memory.LATEST_PLAN = scheduling.current_plan()
# after approval of schedule_job, and in POST /api/cases/{id}/emergency:
plan, diff = scheduling.add_case(case)    # warm-started re-plan, measured solver_ms
memory.LATEST_PLAN = plan                 # emit plan.updated with payload diff (moved/added/dropped, solver_ms)
scheduling.last_meta                      # {"solver", "travel_source", "fallback_from": [...]} for the agent trace
```

If `case.property_id` is missing or unknown, `add_case` assigns a stable synthetic property and writes it back to the case so the twin can light up a house. Emergencies are targeted for a visit within 2 hours (`EMERGENCY_TARGET_MINUTES`, an operational choice, not the legal 24 h deadline). The scheduler uses a demo clock (default 11:00 on the fixture day) so the demo works whatever the real time; see `.env.example` for `SCHEDULER_*` settings.

## Handoff: Person 5 (frontend)

- `frontend/public/properties.geojson`: 400 Point features (`id`, `district`, `archetype`, `floors`, `severity`) — use `floors` for extrusion height.
- `frontend/public/roads.geojson`: generated locally (gitignored). Check `metadata.source`; `synthetic` = straight district links, not real roads.
- `frontend/public/sample-plans.json`: real OR-Tools `before` / `after` Plans for the 11:00 S2 gas emergency, plus `workers`, `jobs`, `emergency_job` and `diff` — enough to build route animation fully offline before the API is wired.

## Status (13 Nov, morning)

- No cuOpt or OSMnx on the Windows dev laptop; OR-Tools 9.15 and the mock both pass validation on the fixtures.
- Benchmark (8 workers, 36 jobs, gas emergency at 11:00): OR-Tools ≈1.0 s (it uses its full time limit; tune `SCHEDULER_TIME_LIMIT_S`), mock ≈20 ms; 0 unassigned and 0 conflicts before and after; OR-Tools moves 2 jobs to absorb the emergency.
- Next: run `python3 -m scheduler.cuopt` and `data/export_roads_geojson.py` on the Spark, record the results here, and rebuild the travel matrix from OSMnx.
