"""NVIDIA cuOpt adapter (GPU). Same inputs/outputs as OR-Tools and the mock.

Install on the Spark (CUDA 13, aarch64 is a supported platform):
    bash scripts/spark/check_cuopt.sh
The DataModel/SolverSettings/Solve calls and get_route() columns below were checked
against the cuOpt Python routing API reference (docs.nvidia.com/cuopt). Still VERIFY
on the Spark: the installed version solves the fixtures (`python3 -m scheduler.cuopt`).
Any exception here is caught by FallbackScheduler, which moves on to OR-Tools/mock.
cuOpt only decides assignment and order; ETAs/slack/conflicts are recomputed by
scheduler.core so every solver's Plan has identical semantics.
"""
from __future__ import annotations

from .core import BaseScheduler, Problem

PRIZE = 1_000  # x priority^2 (prize collection lets cuOpt drop low-value jobs)


def available() -> bool:
    try:
        from cuopt import routing  # noqa: F401
        return True
    except Exception:  # ImportError, missing CUDA libs, etc.
        return False


def status() -> str:
    try:
        import cuopt
        from cuopt import routing  # noqa: F401
        return f"cuopt {getattr(cuopt, '__version__', '?')} import OK"
    except Exception as exc:
        return f"cuopt unavailable: {type(exc).__name__}: {exc}"


class CuOptScheduler(BaseScheduler):
    name = "cuopt"

    def _solve(self, problem: Problem, initial: list[list[int]] | None) -> list[list[int]]:
        import cudf  # VERIFY: ships with cuOpt's RAPIDS dependencies
        from cuopt import routing

        n_w = problem.n_workers
        orders = [j for j in range(len(problem.jobs)) if problem.eligible[j]]
        if n_w == 0 or not orders:
            return [[] for _ in range(n_w)]

        # Locations: worker starts then job sites (same indexing as problem.matrix).
        n_loc = n_w + len(problem.jobs)
        matrix = cudf.DataFrame([[float(x) for x in row] for row in problem.matrix])
        model = routing.DataModel(n_loc, n_w, len(orders))
        model.add_cost_matrix(matrix)
        model.add_transit_time_matrix(matrix)
        model.set_order_locations(cudf.Series([problem.node(j) for j in orders], dtype="int32"))
        model.set_order_time_windows(cudf.Series([problem.window[j][0] for j in orders], dtype="int32"),
                                     cudf.Series([problem.window[j][1] for j in orders], dtype="int32"))
        model.set_order_service_times(cudf.Series([problem.duration[j] for j in orders], dtype="int32"))
        model.set_order_prizes(cudf.Series([PRIZE * max(1, problem.priority[j]) ** 2 for j in orders], dtype="float32"))
        starts = cudf.Series(list(range(n_w)), dtype="int32")
        model.set_vehicle_locations(starts, starts)
        model.set_drop_return_trips(cudf.Series([True] * n_w))  # workers end at their last job
        model.set_vehicle_time_windows(cudf.Series([min(s, e) for s, e in problem.shift], dtype="int32"),
                                       cudf.Series([e for _, e in problem.shift], dtype="int32"))
        for v in range(n_w):
            allowed = [k for k, j in enumerate(orders) if v in problem.eligible[j]]
            if allowed:
                model.add_vehicle_order_match(v, cudf.Series(allowed, dtype="int32"))
        # Warm start is not passed to cuOpt (add_initial_solutions needs per-stop type codes we have not
        # verified); replan() still locks started visits and cuOpt re-solves the rest within the time limit.

        settings = routing.SolverSettings()
        settings.set_time_limit(max(0.1, self.time_limit_s))
        solution = routing.Solve(model, settings)
        if solution.get_status() != 0:
            raise RuntimeError(f"cuOpt status {solution.get_status()}: {solution.get_message()}")

        return routes_from_rows(solution.get_route().to_pandas().to_dict("records"), n_w, len(problem.jobs))


def routes_from_rows(rows: list[dict], n_workers: int, n_jobs: int) -> list[list[int]]:
    """Turn cuOpt get_route() rows into per-worker job-index lists.

    Documented columns: route, arrival_stamp, truck_id, location. `location` (and
    `route`) hold *location* indices, not order numbers. Every job has its own
    location (n_workers + job index), so a location maps straight back to a job;
    worker start/return locations (< n_workers) are skipped. Row order is the
    visit order, so rows are only grouped by truck (stable), never re-sorted.
    """
    routes: list[list[int]] = [[] for _ in range(n_workers)]
    for row in rows:
        location = int(row["location"] if "location" in row else row["route"])
        job = location - n_workers
        if 0 <= job < n_jobs and job not in routes[int(row["truck_id"])]:
            routes[int(row["truck_id"])].append(job)
    return routes


if __name__ == "__main__":
    print(status())
    if available():
        from .core import validate_plan
        from .fixtures import load_jobs, load_workers
        workers, jobs = load_workers(), load_jobs()
        plan = CuOptScheduler().optimise_schedule(workers, jobs)
        print(f"cuopt solved in {plan.solver_ms} ms; unassigned={plan.unassigned_jobs}; "
              f"validation: {validate_plan(plan, workers, jobs) or 'OK'}")
