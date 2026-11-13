"""Solver-independent scheduling core.

Every solver (cuOpt, OR-Tools, mock) only decides *which worker visits which
jobs in which order*. Everything else lives here so the outputs are identical:

  Problem.build()  -> integer-minute model (travel matrix, windows, skills)
  build_plan()     -> simulate routes into a Plan with ETAs, slack, conflicts
  validate_plan()  -> independent check of a Plan against workers/jobs
  replan()         -> warm-started re-plan from workers' current positions
  diff_plans()     -> which jobs moved between workers (for events/animation)

Conventions: datetimes are naive UTC (aware inputs are converted). A job's
`latest` is the latest permitted arrival. Higher `priority` = more urgent.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from time import perf_counter
from typing import Protocol
from uuid import uuid4

from backend.schemas import Job, Plan, Stop, Worker, WorkerPlan

from .travel import TravelModel, default_model

TOLERANCE_MIN = 1  # rounding tolerance when validating


def utcnow() -> datetime:
    """Naive UTC 'now', matching backend.schemas' naive timestamps."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def naive_utc(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _skill(value) -> str:
    return getattr(value, "value", value)


@dataclass
class Problem:
    workers: list[Worker]
    jobs: list[Job]
    t0: datetime
    horizon: int
    matrix: list[list[int]]  # nodes: [worker starts..., jobs...]
    travel_source: str
    shift: list[tuple[int, int]]
    window: list[tuple[int, int]]  # arrival window per job, minutes from t0
    duration: list[int]
    priority: list[int]
    eligible: list[list[int]]  # worker indices per job (empty => cannot be scheduled)
    reasons: dict[int, str] = field(default_factory=dict)  # why a job is unschedulable up front

    @property
    def n_workers(self) -> int:
        return len(self.workers)

    def node(self, job_index: int) -> int:
        return self.n_workers + job_index

    def minutes(self, value: datetime) -> float:
        return (naive_utc(value) - self.t0).total_seconds() / 60

    def at(self, minute: float) -> datetime:
        return self.t0 + timedelta(minutes=minute)

    @classmethod
    def build(cls, workers: list[Worker], jobs: list[Job], travel: TravelModel | None = None) -> "Problem":
        travel = travel or default_model()
        if workers:
            t0 = min(naive_utc(w.shift_start) for w in workers)
            t0 = t0.replace(second=0, microsecond=0)
            end = max(naive_utc(w.shift_end) for w in workers)
            horizon = max(0, math.floor((end - t0).total_seconds() / 60))
        else:
            t0, horizon = utcnow().replace(second=0, microsecond=0), 0
        points = [(w.lat, w.lon) for w in workers] + [(j.lat, j.lon) for j in jobs]
        matrix, source = travel.matrix(points)
        problem = cls(workers=workers, jobs=jobs, t0=t0, horizon=horizon, matrix=matrix, travel_source=source,
                      shift=[], window=[], duration=[], priority=[], eligible=[])
        for w in workers:
            start = math.ceil(problem.minutes(w.shift_start))
            stop = math.floor(problem.minutes(w.shift_end))
            problem.shift.append((max(0, start), max(0, min(stop, horizon))))
        for index, job in enumerate(jobs):
            earliest = 0 if job.earliest is None else max(0, math.ceil(problem.minutes(job.earliest)))
            latest = horizon if job.latest is None else min(horizon, math.floor(problem.minutes(job.latest)))
            problem.window.append((earliest, latest))
            problem.duration.append(max(0, int(job.duration_minutes)))
            problem.priority.append(int(job.priority))
            skilled = [i for i, w in enumerate(workers) if _skill(job.required_skill) in {_skill(s) for s in w.skills}]
            eligible = [i for i in skilled
                        if max(earliest, problem.shift[i][0]) <= min(latest, problem.shift[i][1] - problem.duration[-1])]
            if job.latest is not None and problem.minutes(job.latest) < 0:
                problem.reasons[index] = "deadline passed before any shift starts"
            elif earliest > latest:
                problem.reasons[index] = "appointment window is outside every shift"
            elif not skilled:
                problem.reasons[index] = f"no worker with skill '{_skill(job.required_skill)}'"
            elif not eligible:
                problem.reasons[index] = f"no '{_skill(job.required_skill)}' worker on shift during its window"
            problem.eligible.append([] if index in problem.reasons else eligible)
        return problem

    def simulate(self, worker_index: int, route: list[int]) -> tuple[list[int], int, int, list[str]]:
        """Return (arrival minute per stop, finish minute, travel minutes, violations)."""
        start, stop = self.shift[worker_index]
        t, pos, travel_total = start, worker_index, 0
        arrivals, violations = [], []
        for j in route:
            leg = self.matrix[pos][self.node(j)]
            travel_total += leg
            t = max(t + leg, self.window[j][0])
            arrivals.append(t)
            if t > self.window[j][1]:
                violations.append(f"{self.jobs[j].id} arrival {t - self.window[j][1]} min after its window")
            t += self.duration[j]
            pos = self.node(j)
        if t > stop:
            violations.append(f"{self.workers[worker_index].id} finishes {t - stop} min after shift end")
        return arrivals, t, travel_total, violations

    def feasible(self, worker_index: int, route: list[int]) -> tuple[bool, int, int]:
        start, stop = self.shift[worker_index]
        t, pos, travel_total = start, worker_index, 0
        for j in route:
            if worker_index not in self.eligible[j]:
                return False, t, travel_total
            leg = self.matrix[pos][self.node(j)]
            travel_total += leg
            t = max(t + leg, self.window[j][0])
            if t > self.window[j][1]:
                return False, t, travel_total
            t += self.duration[j]
            pos = self.node(j)
        return t <= stop, t, travel_total


def build_plan(problem: Problem, routes: list[list[int]], solver: str, solver_ms: float,
               notes: list[str] | None = None) -> Plan:
    worker_plans, conflicts, assigned = [], list(notes or []), set()
    for w_index, worker in enumerate(problem.workers):
        route = [j for j in routes[w_index] if j not in assigned] if w_index < len(routes) else []
        assigned.update(route)
        arrivals, _, _, violations = problem.simulate(w_index, route)
        conflicts.extend(violations)
        stops = []
        for j, arrival in zip(route, arrivals):
            job = problem.jobs[j]
            eta = problem.at(arrival)
            slack = None if job.latest is None else math.floor((naive_utc(job.latest) - eta).total_seconds() / 60)
            stops.append(Stop(job_id=job.id, eta=eta, lat=job.lat, lon=job.lon, slack_minutes=slack))
        worker_plans.append(WorkerPlan(worker_id=worker.id, stops=stops))
    unassigned = [j for j in range(len(problem.jobs)) if j not in assigned]
    for j in sorted(unassigned, key=lambda j: -problem.priority[j]):
        job = problem.jobs[j]
        reason = problem.reasons.get(j, "no capacity before its deadline")
        conflicts.append(f"{job.id} (case {job.case_id}, priority {job.priority}) unassigned: {reason}")
    return Plan(id=f"plan-{uuid4().hex[:8]}", solver=solver, solver_ms=round(solver_ms, 1), workers=worker_plans,
                unassigned_jobs=[problem.jobs[j].id for j in unassigned], conflicts=conflicts)


def validate_plan(plan: Plan, workers: list[Worker], jobs: list[Job], travel: TravelModel | None = None) -> list[str]:
    """Independent check; returns human-readable violations (empty list = valid)."""
    travel = travel or default_model()
    errors: list[str] = []
    jobs_by_id = {j.id: j for j in jobs}
    workers_by_id = {w.id: w for w in workers}
    seen: set[str] = set()
    for wp in plan.workers:
        worker = workers_by_id.get(wp.worker_id)
        if worker is None:
            errors.append(f"unknown worker {wp.worker_id}")
            continue
        skills = {_skill(s) for s in worker.skills}
        shift_start, shift_end = naive_utc(worker.shift_start), naive_utc(worker.shift_end)
        free_at, pos = shift_start, (worker.lat, worker.lon)
        for stop in wp.stops:
            job = jobs_by_id.get(stop.job_id)
            if job is None:
                errors.append(f"{wp.worker_id}: unknown job {stop.job_id}")
                continue
            if stop.job_id in seen:
                errors.append(f"{stop.job_id} assigned more than once")
            seen.add(stop.job_id)
            eta = naive_utc(stop.eta)
            tol = timedelta(minutes=TOLERANCE_MIN)
            if _skill(job.required_skill) not in skills:
                errors.append(f"{wp.worker_id} lacks skill {_skill(job.required_skill)} for {job.id}")
            earliest_arrival = free_at + timedelta(minutes=math.ceil(travel.minutes(pos, (job.lat, job.lon))))
            if eta + tol < earliest_arrival:
                errors.append(f"{job.id}: ETA {eta:%H:%M} is before {wp.worker_id} can arrive ({earliest_arrival:%H:%M})")
            if job.earliest and eta + tol < naive_utc(job.earliest):
                errors.append(f"{job.id}: ETA {eta:%H:%M} before window opens")
            if job.latest and eta - tol > naive_utc(job.latest):
                errors.append(f"{job.id}: ETA {eta:%H:%M} after deadline {naive_utc(job.latest):%H:%M}")
            finish = eta + timedelta(minutes=job.duration_minutes)
            if finish - tol > shift_end:
                errors.append(f"{job.id}: finishes {finish:%H:%M} after {wp.worker_id} shift end")
            free_at, pos = max(free_at, finish), (job.lat, job.lon)
    for job_id in plan.unassigned_jobs:
        if job_id in seen:
            errors.append(f"{job_id} is both assigned and unassigned")
        seen.add(job_id)
    missing = set(jobs_by_id) - seen
    if missing:
        errors.append(f"jobs missing from plan: {sorted(missing)}")
    return errors


class SolveFn(Protocol):
    def optimise_schedule(self, workers: list[Worker], jobs: list[Job],
                          initial_routes: dict[str, list[str]] | None = None) -> Plan: ...


def routes_by_id(plan: Plan) -> dict[str, list[str]]:
    return {wp.worker_id: [s.job_id for s in wp.stops] for wp in plan.workers}


def replan(scheduler: SolveFn, current: Plan | None, workers: list[Worker], jobs: list[Job],
           now: datetime | None = None) -> Plan:
    """Re-optimise from `now`, keeping visits that have already started.

    Each worker restarts from their current/last location once their in-progress
    job finishes, and the current routes are offered to the solver as a warm start.
    """
    started = perf_counter()
    now = naive_utc(now) or utcnow()
    jobs_by_id = {j.id: j for j in jobs}
    current_routes = {wp.worker_id: wp.stops for wp in current.workers} if current else {}
    locked: dict[str, list[Stop]] = {}
    shifted: list[Worker] = []
    for worker in workers:
        stops = current_routes.get(worker.id, [])
        done = [s for s in stops if naive_utc(s.eta) <= now and s.job_id in jobs_by_id]
        locked[worker.id] = done
        free_at, lat, lon = max(now, naive_utc(worker.shift_start)), worker.lat, worker.lon
        if done:
            last = done[-1]
            free_at = max(free_at, naive_utc(last.eta) + timedelta(minutes=jobs_by_id[last.job_id].duration_minutes))
            lat, lon = last.lat, last.lon
        free_at = min(free_at, naive_utc(worker.shift_end))
        shifted.append(worker.model_copy(update={"shift_start": free_at, "lat": lat, "lon": lon}))
    locked_ids = {s.job_id for stops in locked.values() for s in stops}
    remaining = [j for j in jobs if j.id not in locked_ids]
    warm = {wid: [s.job_id for s in stops if s.job_id not in locked_ids and s.job_id in jobs_by_id]
            for wid, stops in current_routes.items()}
    plan = scheduler.optimise_schedule(shifted, remaining, initial_routes=warm)
    for wp in plan.workers:
        wp.stops = locked.get(wp.worker_id, []) + wp.stops
    plan.solver_ms = round((perf_counter() - started) * 1000, 1)
    return plan


def diff_plans(old: Plan | None, new: Plan) -> dict:
    """Summarise route changes; handy for `plan.updated` events and route animation."""
    def owners(plan: Plan | None) -> dict[str, str]:
        return {} if plan is None else {s.job_id: wp.worker_id for wp in plan.workers for s in wp.stops}
    before, after = owners(old), owners(new)
    moved = [{"job_id": j, "from": before[j], "to": after[j]} for j in after if j in before and before[j] != after[j]]
    added = [{"job_id": j, "to": after[j]} for j in after if j not in before]
    dropped = [{"job_id": j, "from": before[j]} for j in before if j not in after]
    changed_workers = sorted({m["from"] for m in moved} | {m["to"] for m in moved}
                             | {a["to"] for a in added} | {d["from"] for d in dropped})
    return {"moved": moved, "added": added, "dropped": dropped, "changed_workers": changed_workers,
            "solver": new.solver, "solver_ms": new.solver_ms}


class BaseScheduler:
    """Shared template: subclasses implement `_solve(problem, initial) -> routes`."""
    name = "base"

    def __init__(self, travel: TravelModel | None = None, time_limit_s: float = 1.0):
        self.travel = travel
        self.time_limit_s = time_limit_s
        self.last_meta: dict = {}

    def _solve(self, problem: Problem, initial: list[list[int]] | None) -> list[list[int]]:
        raise NotImplementedError

    def optimise_schedule(self, workers: list[Worker], jobs: list[Job],
                          initial_routes: dict[str, list[str]] | None = None) -> Plan:
        started = perf_counter()
        problem = Problem.build(workers, jobs, self.travel)
        initial = None
        if initial_routes:
            index = {job.id: i for i, job in enumerate(jobs)}
            initial = [[index[j] for j in initial_routes.get(w.id, []) if j in index] for w in workers]
        routes = self._solve(problem, initial)
        plan = build_plan(problem, routes, self.name, (perf_counter() - started) * 1000)
        self.last_meta = {"solver": self.name, "travel_source": problem.travel_source,
                          "workers": len(workers), "jobs": len(jobs), "warm_start": initial is not None}
        return plan

    def replan(self, current: Plan | None, workers: list[Worker], jobs: list[Job], now: datetime | None = None) -> Plan:
        return replan(self, current, workers, jobs, now)
