"""NVIDIA cuOpt adapter (GPU). Same inputs/outputs as OR-Tools and the mock.

VERIFY on the Spark before relying on it:
  * cuOpt installs and imports on aarch64 (`python3 -m scheduler.cuopt` prints status)
  * the Python API names used below (cuopt.routing.DataModel, SolverSettings, Solve,
    get_route column names) match the installed version.
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
        model.set_drop_return_trips(cudf.Series([True] * n_w))  # VERIFY: workers end at their last job
        model.set_vehicle_time_windows(cudf.Series([min(s, e) for s, e in problem.shift], dtype="int32"),
                                       cudf.Series([e for _, e in problem.shift], dtype="int32"))
        for v in range(n_w):
            allowed = [k for k, j in enumerate(orders) if v in problem.eligible[j]]
            if allowed:
                model.add_vehicle_order_match(v, cudf.Series(allowed, dtype="int32"))
        # VERIFY: warm start via model.add_initial_solutions(...) if the installed version supports it.

        settings = routing.SolverSettings()
        settings.set_time_limit(max(0.1, self.time_limit_s))
        solution = routing.Solve(model, settings)
        if solution.get_status() != 0:
            raise RuntimeError(f"cuOpt status {solution.get_status()}: {solution.get_message()}")

        frame = solution.get_route().to_pandas()  # VERIFY columns: truck_id, route, type, arrival_stamp
        routes: list[list[int]] = [[] for _ in range(n_w)]
        for _, row in frame.sort_values(["truck_id", "arrival_stamp"]).iterrows():
            if str(row.get("type", "")).lower() not in ("delivery", "task", "order"):
                continue
            order_index = int(row["route"])
            routes[int(row["truck_id"])].append(orders[order_index])
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
