"""OR-Tools VRPTW solver: same inputs and outputs as cuOpt and the mock.

Model: one vehicle per worker, starting at their location and ending anywhere
(dummy end node). Time dimension = travel + service time; job windows bound the
arrival time; shifts bound start/end. Skills restrict allowed vehicles. Each job
is optional with a drop penalty that grows with priority, so an emergency will
displace routine work instead of being left out.
"""
from __future__ import annotations

from .core import BaseScheduler, Problem

DROP_PENALTY = 100_000  # x priority^2; far above any travel saving


def available() -> bool:
    try:
        import ortools.constraint_solver.pywrapcp  # noqa: F401
        return True
    except ImportError:
        return False


class OrToolsScheduler(BaseScheduler):
    name = "ortools"

    def _solve(self, problem: Problem, initial: list[list[int]] | None) -> list[list[int]]:
        from ortools.constraint_solver import pywrapcp, routing_enums_pb2

        n_w, n_j = problem.n_workers, len(problem.jobs)
        if n_w == 0:
            return []
        end_node = n_w + n_j
        manager = pywrapcp.RoutingIndexManager(n_w + n_j + 1, n_w, list(range(n_w)), [end_node] * n_w)
        routing = pywrapcp.RoutingModel(manager)

        service = [0] * n_w + problem.duration + [0]

        def travel(i: int, k: int) -> int:
            a, b = manager.IndexToNode(i), manager.IndexToNode(k)
            return 0 if a == end_node or b == end_node else problem.matrix[a][b]

        def transit(i: int, k: int) -> int:
            return travel(i, k) + service[manager.IndexToNode(i)]

        routing.SetArcCostEvaluatorOfAllVehicles(routing.RegisterTransitCallback(travel))
        horizon = max(problem.horizon, 1)
        routing.AddDimension(routing.RegisterTransitCallback(transit), horizon, horizon, False, "Time")
        time = routing.GetDimensionOrDie("Time")

        for v, (start, stop) in enumerate(problem.shift):
            start = min(start, stop)
            time.CumulVar(routing.Start(v)).SetRange(start, stop)
            time.CumulVar(routing.End(v)).SetRange(start, stop)
            routing.AddVariableMinimizedByFinalizer(time.CumulVar(routing.End(v)))

        for j in range(n_j):
            index = manager.NodeToIndex(problem.node(j))
            routing.AddDisjunction([index], DROP_PENALTY * max(1, problem.priority[j]) ** 2)
            if not problem.eligible[j]:
                routing.VehicleVar(index).SetValues([-1])  # can only be dropped
                continue
            earliest, latest = problem.window[j]
            time.CumulVar(index).SetRange(earliest, latest)
            # -1 = unperformed; otherwise only skilled workers may take it.
            routing.VehicleVar(index).SetValues([-1] + problem.eligible[j])

        params = pywrapcp.DefaultRoutingSearchParameters()
        params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
        params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        params.time_limit.FromMilliseconds(max(100, int(self.time_limit_s * 1000)))

        solution = None
        if initial:
            routing.CloseModelWithParameters(params)
            warm = [[manager.NodeToIndex(problem.node(j)) for j in route if v in problem.eligible[j]]
                    for v, route in enumerate(initial[:n_w])]
            warm += [[] for _ in range(n_w - len(warm))]
            assignment = routing.ReadAssignmentFromRoutes(warm, True)
            if assignment is not None:
                solution = routing.SolveFromAssignmentWithParameters(assignment, params)
        if solution is None:
            solution = routing.SolveWithParameters(params)
        if solution is None:
            raise RuntimeError(f"OR-Tools found no solution (status {routing.status()})")

        routes = []
        for v in range(n_w):
            route, index = [], solution.Value(routing.NextVar(routing.Start(v)))
            while not routing.IsEnd(index):
                route.append(manager.IndexToNode(index) - n_w)
                index = solution.Value(routing.NextVar(index))
            routes.append(route)
        return routes
