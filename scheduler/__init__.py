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
    def __init__(self, chain: list[BaseScheduler], *, initial_failures: list[str] | None = None,
                 requested: str = "auto", allow_fallback: bool = True):
        self.chain = chain
        self.initial_failures = list(initial_failures or [])
        self.requested = requested
        self.allow_fallback = allow_fallback
        self.last_meta: dict = {"requested": requested, "fallback_from": self.initial_failures}

    @property
    def name(self) -> str:
        return ">".join(s.name for s in self.chain)

    def optimise_schedule(self, workers: list[Worker], jobs: list[Job],
                          initial_routes: dict[str, list[str]] | None = None) -> Plan:
        failures = list(self.initial_failures)
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


def get_scheduler(name: str | None = None, time_limit_s: float | None = None,
                  allow_fallback: bool | None = None) -> FallbackScheduler:
    from . import cuopt, ortools
    from .mock import MockScheduler

    name = (name or os.getenv("SCHEDULER", "auto")).lower()
    if name not in {"auto", "cuopt", "ortools", "mock"}:
        raise ValueError(f"unknown scheduler adapter: {name}")
    limit = _time_limit() if time_limit_s is None else time_limit_s
    if allow_fallback is None:
        allow_fallback = os.getenv("SCHEDULER_ALLOW_FALLBACK", "true").strip().lower() in {"1", "true", "yes", "on"}
    chain: list[BaseScheduler] = []
    failures: list[str] = []
    if name in ("auto", "cuopt"):
        if cuopt.available():
            chain.append(cuopt.CuOptScheduler(time_limit_s=limit))
        else:
            failures.append(cuopt.status())
    if name in ("auto", "ortools") or (name == "cuopt" and allow_fallback):
        if ortools.available():
            chain.append(ortools.OrToolsScheduler(time_limit_s=limit))
        else:
            failures.append("ortools unavailable: import failed")
    if name == "mock" or name == "auto" or allow_fallback:
        chain.append(MockScheduler(time_limit_s=limit))
    return FallbackScheduler(chain, initial_failures=failures, requested=name, allow_fallback=allow_fallback)
