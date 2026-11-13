# Person 4 — cuOpt, scheduling and map data

## Goal and ownership

Own worker/job fixtures, travel data, `Scheduler`, cuOpt/OR-Tools fallback, properties, and roads. Do not build API or UI.

## Commands

```powershell
py data/generate_synthetic.py
py data/generate_properties.py
py -m scheduler.mock
```

On Spark, `py` becomes `python3`; test cuOpt separately. `VERIFY:` aarch64 installation and exact cuOpt API. If it fails, keep the same `Scheduler` interface and use OR-Tools or the deterministic mock.

## Contract and checkpoints

Return ordered stops, ETAs, slack, unassigned jobs, conflicts, solver name, and milliseconds. At 13:00 a mock Plan is accepted by the API; at 15:00 an urgent job produces a measured revised Plan. Done means the demo never blocks on a solver.

## Checklist

- [ ] Eight workers and at least 30 jobs are generated.
- [ ] 300-500 properties and local road GeoJSON are available.
- [ ] Travel matrix has an OSMnx path or labelled haversine fallback.
- [ ] cuOpt status is recorded on the Spark.
- [ ] OR-Tools/mock fallback has identical inputs and outputs.
- [ ] Emergency re-plan reports solver time and conflicts.
