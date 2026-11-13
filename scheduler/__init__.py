"""Scheduling package. Backend usage:

    from scheduler import get_scheduler
    scheduler = get_scheduler()                     # SCHEDULER=auto|cuopt|ortools|mock
    plan = scheduler.optimise_schedule(workers, jobs)
    plan = scheduler.replan(plan, workers, jobs + [emergency_job], now)

`get_scheduler()` returns a FallbackScheduler: it tries cuOpt, then OR-Tools,
then the pure-Python mock, so a Plan is always produced.
"""
from __future__ import annotations

import os
from datetime import datetime

from backend.schemas import Job, Plan, Worker

from .core import BaseScheduler, diff_plans, replan, validate_plan
from .interface import Scheduler

__all__ = ["Scheduler", "FallbackScheduler", "get_scheduler", "diff_plans", "validate_plan"]


class FallbackScheduler:
    def __init__(self, chain: list[BaseScheduler]):
        self.chain = chain
        self.last_meta: dict = {}

    @property
    def name(self) -> str:
        return ">".join(s.name for s in self.chain)

    def optimise_schedule(self, workers: list[Worker], jobs: list[Job],
                          initial_routes: dict[str, list[str]] | None = None) -> Plan:
        failures = []
        for solver in self.chain:
            try:
                plan = solver.optimise_schedule(workers, jobs, initial_routes=initial_routes)
            except Exception as exc:  # never block the demo on one solver
                failures.append(f"{solver.name}: {type(exc).__name__}: {exc}")
                continue
            self.last_meta = {**solver.last_meta, "fallback_from": failures}
            return plan
        raise RuntimeError("every scheduler failed: " + "; ".join(failures))

    def replan(self, current: Plan | None, workers: list[Worker], jobs: list[Job],
               now: datetime | None = None) -> Plan:
        return replan(self, current, workers, jobs, now)


def _time_limit() -> float:
    try:
        return float(os.getenv("SCHEDULER_TIME_LIMIT_S", "1.0"))
    except ValueError:
        return 1.0


def get_scheduler(name: str | None = None, time_limit_s: float | None = None) -> FallbackScheduler:
    from . import cuopt, ortools
    from .mock import MockScheduler

    name = (name or os.getenv("SCHEDULER", "auto")).lower()
    limit = _time_limit() if time_limit_s is None else time_limit_s
    chain: list[BaseScheduler] = []
    if name in ("auto", "cuopt") and cuopt.available():
        chain.append(cuopt.CuOptScheduler(time_limit_s=limit))
    if name in ("auto", "cuopt", "ortools") and ortools.available():
        chain.append(ortools.OrToolsScheduler(time_limit_s=limit))
    chain.append(MockScheduler(time_limit_s=limit))
    return FallbackScheduler(chain)
