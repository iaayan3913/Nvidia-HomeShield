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

On Spark, `py` becomes `python3`. One command checks the GPU, optionally installs cuOpt, solves the fixtures with cuOpt and benchmarks every solver, saving the output to `data/generated/cuopt_status.txt`:

```bash
PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh --deps   # first run: adds pydantic + ortools
PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh          # afterwards
```

The adapter's API calls were checked against the cuOpt Python routing reference (`get_route()` returns `route`, `arrival_stamp`, `truck_id`, `location`; status 0 = success). `VERIFY:` that the pip package (`cuopt-cu13`, or `cuopt-cu12` on CUDA 12) installs on the Spark; the fallback is the `nvidia/cuopt` container. If it fails, nothing changes for the demo: the same `Scheduler` interface falls back to OR-Tools, then the mock.

## Contract and checkpoints

Return ordered stops, ETAs, slack, unassigned jobs, conflicts, solver name, and milliseconds. At 13:00 a mock Plan is accepted by the API; at 15:00 an urgent job produces a measured revised Plan. Done means the demo never blocks on a solver.

## Checklist

- [x] Eight workers and at least 30 jobs are generated (36, deterministic, seed 44).
- [x] 300-500 properties and local road GeoJSON are available (400 properties; real OSMnx roads verified on the dev laptop, synthetic fallback otherwise).
- [x] Travel matrix has an OSMnx path or labelled haversine fallback (`haversine_x1.3_at_25kmh`); OSMnx path verified (`osmnx_drive_travel_time`).
- [x] cuOpt status is recorded on the Spark: cuOpt 26.10.1 (cu13) in `~/cuopt-env`, `from cuopt import routing` OK (Person 1, 13 Nov). Fixture solve: pending `check_cuopt.sh`.
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

## Status (13 Nov, late morning)

- OSMnx 2.1 works on the Windows dev laptop (`pip install osmnx`; needs internet once). `export_roads_geojson.py` wrote 21,637 road segments (5.8 MB; `--major` gives 5,425 segments, 1.5 MB) and cached `data/generated/sheffield_drive.graphml`; `build_travel_matrix.py` built the 408×408 matrix in 20 s. Nearest-node lookup uses numpy, so scikit-learn is not needed.
- OSM travel times are free-flow (speed limits, no traffic or parking): median 10 min between properties, max 54 min, about 0.54× the conservative haversine fallback. Both files are gitignored, so each machine builds its own; the scheduler reports which one it used (`travel_source`).
- Benchmark (8 workers, gas emergency at 11:00): OR-Tools ≈1.0 s at 30, 40 and 50 jobs (it uses its full time limit; tune `SCHEDULER_TIME_LIMIT_S`), mock < 30 ms; every plan validates and the emergency is always assigned. At 40–50 jobs some routine jobs are unassigned: that is the 8-worker day being full, reported as conflicts.
- How many *other* jobs move to absorb the emergency varies with the travel matrix, the time of day and OR-Tools' time-limited search (0–10 in tests); the receiving worker's route always changes and nothing is dropped at 11:00.
- cuOpt adapter checked against the cuOpt Python routing API reference; fixed route parsing (`get_route()` returns location indices, not order ids). Not yet run on a GPU.
- cuOpt 26.10.1 (cu13) installed on the Spark by Person 1 in `~/cuopt-env`; import check OK.
- Backend integration done by Fowzan (Person 3): `HomeShieldService` uses `get_scheduler()`, `SchedulingService`, `case_to_job` and warm-start `replan()` (`backend/tests/test_scheduler_integration.py`).
- Next: on the Spark, `PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh --deps`, then paste `data/generated/cuopt_status.txt` here.
