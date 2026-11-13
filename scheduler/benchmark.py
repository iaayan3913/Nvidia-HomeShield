"""Before/after emergency benchmark for every available solver.

  py -m scheduler.benchmark                  # all available solvers
  py -m scheduler.benchmark --at 11:00 --export

At `--at` (fixture-day time) a suspected gas leak is injected and each solver
re-plans from workers' current positions. `--export` writes
frontend/public/sample-plans.json (before, after, diff, workers) so the twin can
animate a real re-plan fully offline.
"""
from __future__ import annotations

import argparse
import json

from data.sheffield import FIXTURE_DAY, FRONTEND_PUBLIC

from . import cuopt, ortools
from .core import BaseScheduler, diff_plans, utcnow, validate_plan
from .fixtures import demo_emergency_job, load_jobs, load_workers
from .mock import MockScheduler


def solvers(time_limit_s: float) -> list[BaseScheduler]:
    out: list[BaseScheduler] = [MockScheduler(time_limit_s=time_limit_s)]
    if ortools.available():
        out.append(ortools.OrToolsScheduler(time_limit_s=time_limit_s))
    if cuopt.available():
        out.append(cuopt.CuOptScheduler(time_limit_s=time_limit_s))
    return out


def summarise(plan, workers, jobs) -> dict:
    return {"assigned": sum(len(wp.stops) for wp in plan.workers), "unassigned": len(plan.unassigned_jobs),
            "conflicts": len(plan.conflicts), "invalid": len(validate_plan(plan, workers, jobs)),
            "ms": plan.solver_ms}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--at", default="11:00", help="emergency time on the fixture day, HH:MM")
    parser.add_argument("--time-limit", type=float, default=1.0, help="seconds per solve")
    parser.add_argument("--export", action="store_true", help="write frontend/public/sample-plans.json")
    args = parser.parse_args()

    workers, jobs = load_workers(), load_jobs()
    hour, minute = map(int, args.at.split(":"))
    now = FIXTURE_DAY.replace(hour=hour, minute=minute)
    emergency = demo_emergency_job(now)
    print(f"{len(workers)} workers, {len(jobs)} jobs; emergency {emergency.id} ({emergency.required_skill.value}) at {now:%H:%M}\n")
    print(f"{'solver':<8} {'phase':<7} {'ms':>8} {'assigned':>9} {'unassigned':>11} {'conflicts':>10} {'invalid':>8}  changes")
    exported = None
    for solver in solvers(args.time_limit):
        before = solver.optimise_schedule(workers, jobs)
        after = solver.replan(before, workers, jobs + [emergency], now)
        diff = diff_plans(before, after)
        for phase, plan, js in (("before", before, jobs), ("after", after, jobs + [emergency])):
            s = summarise(plan, workers, js)
            changes = "" if phase == "before" else (f"{len(diff['moved'])} moved, {len(diff['dropped'])} dropped, "
                                                    f"emergency -> {next((a['to'] for a in diff['added']), 'UNASSIGNED')}")
            print(f"{solver.name:<8} {phase:<7} {s['ms']:>8.1f} {s['assigned']:>9} {s['unassigned']:>11} "
                  f"{s['conflicts']:>10} {s['invalid']:>8}  {changes}")
        for conflict in after.conflicts:
            print(f"         conflict: {conflict}")
        exported = (solver, before, after, diff)  # last = best available solver
    if args.export and exported:
        solver, before, after, diff = exported
        FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
        payload = {"generated_at": utcnow().isoformat(), "solver": solver.name,
                   "travel_source": solver.last_meta.get("travel_source"), "emergency_at": now.isoformat(),
                   "emergency_job": emergency.model_dump(mode="json"),
                   "workers": [w.model_dump(mode="json") for w in workers],
                   "jobs": [j.model_dump(mode="json") for j in jobs],
                   "before": before.model_dump(mode="json"), "after": after.model_dump(mode="json"), "diff": diff}
        (FRONTEND_PUBLIC / "sample-plans.json").write_text(json.dumps(payload, indent=2))
        print(f"\nexported {solver.name} before/after plans -> frontend/public/sample-plans.json")


if __name__ == "__main__":
    main()
