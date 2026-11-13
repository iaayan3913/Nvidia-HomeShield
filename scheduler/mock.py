"""Deterministic pure-Python scheduler: the last-resort fallback that never fails.

Greedy cheapest insertion in priority order, respecting skills, shifts,
appointment windows and durations. If an urgent job does not fit, it may bump
one strictly lower-priority job, which is then re-inserted elsewhere if possible.
With a warm start it keeps the previous routes and only repairs them, so a
re-plan changes as little as possible.
"""
from __future__ import annotations

from .core import BaseScheduler, Problem

BALANCE_WEIGHT = 0.05  # small preference for less-loaded workers


class MockScheduler(BaseScheduler):
    name = "mock"

    def _best_insertion(self, problem: Problem, routes: list[list[int]], j: int):
        best = None
        for w in problem.eligible[j]:
            _, base_end, base_travel = problem.feasible(w, routes[w])
            for pos in range(len(routes[w]) + 1):
                candidate = routes[w][:pos] + [j] + routes[w][pos:]
                ok, end, travel = problem.feasible(w, candidate)
                if ok:
                    cost = (travel - base_travel) + BALANCE_WEIGHT * end
                    if best is None or cost < best[0]:
                        best = (cost, w, pos)
        return best

    def _insert_with_bump(self, problem: Problem, routes: list[list[int]], j: int) -> int | None:
        """Insert j, possibly bumping one lower-priority job. Returns the bumped job or None."""
        best = self._best_insertion(problem, routes, j)
        if best:
            _, w, pos = best
            routes[w].insert(pos, j)
            return None
        bump = None
        for w in problem.eligible[j]:
            for k, victim in enumerate(routes[w]):
                if problem.priority[victim] >= problem.priority[j]:
                    continue
                trial = [list(r) for r in routes]
                del trial[w][k]
                found = self._best_insertion(problem, trial, j)
                if found and found[1] == w:
                    key = (problem.priority[victim], found[0])
                    if bump is None or key < bump[0]:
                        bump = (key, w, k, found[2])
        if bump is None:
            return None
        _, w, k, pos = bump
        victim = routes[w].pop(k)
        routes[w].insert(pos, j)
        return victim

    def _solve(self, problem: Problem, initial: list[list[int]] | None) -> list[list[int]]:
        cold = self._greedy(problem, None)
        if not initial:
            return cold
        warm = self._greedy(problem, initial)
        # Prefer the minimal-change repair unless a fresh solve leaves less urgent work behind.
        return cold if self._dropped_weight(problem, cold) < self._dropped_weight(problem, warm) else warm

    @staticmethod
    def _dropped_weight(problem: Problem, routes: list[list[int]]) -> int:
        placed = {j for route in routes for j in route}
        return sum(problem.priority[j] ** 2 for j in range(len(problem.jobs)) if j not in placed)

    def _greedy(self, problem: Problem, initial: list[list[int]] | None) -> list[list[int]]:
        routes: list[list[int]] = [[] for _ in problem.workers]
        placed: set[int] = set()
        if initial:  # keep the previous plan where it is still feasible
            for w, route in enumerate(initial[: len(routes)]):
                for j in route:
                    if j not in placed and problem.feasible(w, routes[w] + [j])[0]:
                        routes[w].append(j)
                        placed.add(j)
        order = sorted((j for j in range(len(problem.jobs)) if j not in placed and problem.eligible[j]),
                       key=lambda j: (-problem.priority[j], problem.window[j][1], problem.window[j][0], problem.jobs[j].id))
        pending = list(order)
        bumped_once: set[int] = set()
        while pending:
            j = pending.pop(0)
            victim = self._insert_with_bump(problem, routes, j)
            if victim is not None and victim not in bumped_once:
                bumped_once.add(victim)
                best = self._best_insertion(problem, routes, victim)
                if best:
                    routes[best[1]].insert(best[2], victim)
        return routes


if __name__ == "__main__":
    from .core import validate_plan
    from .fixtures import load_jobs, load_workers
    workers, jobs = load_workers(), load_jobs()
    plan = MockScheduler().optimise_schedule(workers, jobs)
    print(plan.model_dump_json(indent=2))
    assigned = sum(len(wp.stops) for wp in plan.workers)
    print(f"\n{plan.solver}: {assigned}/{len(jobs)} jobs assigned to {len(workers)} workers in {plan.solver_ms} ms; "
          f"{len(plan.unassigned_jobs)} unassigned; validation errors: {validate_plan(plan, workers, jobs) or 'none'}")
