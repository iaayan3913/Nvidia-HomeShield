"""Stateful scheduling facade for the backend (Person 3 integration point).

    from scheduler.service import SchedulingService
    scheduling = SchedulingService()               # seeds 8 workers + 36 fixture jobs
    plan = scheduling.current_plan()               # GET /api/plans/latest
    plan, diff = scheduling.add_case(case)         # after approval of schedule_job
    plan, diff = scheduling.add_case(case)         # emergency: same call, warm-started re-plan
    scheduling.last_meta                           # solver, travel_source, fallback_from

Demo clock: shifts in the fixtures run 07:00-18:00 on 2026-11-13. So the demo
works at any real time of day, "now" for scheduling is
SCHEDULER_DEMO_START (default 11:00 on the fixture day) plus real elapsed time
x SCHEDULER_DEMO_SPEED (default 1). Set SCHEDULER_CLOCK=real to use the wall clock
(fixtures are then rebased onto today's date).
"""
from __future__ import annotations

import os
import zlib
from datetime import datetime, timedelta
from threading import Lock
from time import monotonic

from backend.schemas import Case, Job, Plan

from . import FallbackScheduler, diff_plans, get_scheduler
from .core import utcnow
from .fixtures import _raw, case_to_job, load_jobs, load_workers, property_location


class DemoClock:
    def __init__(self) -> None:
        from data.sheffield import FIXTURE_DAY
        self.real = os.getenv("SCHEDULER_CLOCK", "demo").lower() == "real"
        hour, minute = map(int, os.getenv("SCHEDULER_DEMO_START", "11:00").split(":"))
        self.start = FIXTURE_DAY.replace(hour=hour, minute=minute)
        self.speed = float(os.getenv("SCHEDULER_DEMO_SPEED", "1"))
        self._t0 = monotonic()

    @property
    def day(self):
        return utcnow().date() if self.real else self.start.date()

    def now(self) -> datetime:
        if self.real:
            return utcnow()
        return self.start + timedelta(seconds=(monotonic() - self._t0) * self.speed)


class SchedulingService:
    def __init__(self, scheduler: FallbackScheduler | None = None, seed_jobs: bool = True):
        self.clock = DemoClock()
        self.scheduler = scheduler or get_scheduler()
        rebase = self.clock.day if self.clock.real else None
        self.workers = load_workers(rebase)
        self.jobs: dict[str, Job] = {j.id: j for j in load_jobs(rebase)} if seed_jobs else {}
        self._lock = Lock()
        self._plan: Plan | None = None
        self.last_meta: dict = {}

    def current_plan(self) -> Plan:
        with self._lock:
            if self._plan is None:
                self._plan = self.scheduler.optimise_schedule(self.workers, list(self.jobs.values()))
                self.last_meta = self.scheduler.last_meta
            return self._plan

    def resolve_property(self, case: Case) -> str:
        """Use the case's property if known; otherwise pick a stable synthetic one and record it on the case."""
        if property_location(case.property_id):
            return case.property_id
        properties = _raw("properties")
        case.property_id = properties[zlib.crc32(case.id.encode()) % len(properties)]["id"]
        return case.property_id

    def add_case(self, case: Case) -> tuple[Plan, dict]:
        """Add (or update) a case's job and re-plan from now. Returns (plan, diff)."""
        self.resolve_property(case)
        before = self.current_plan()
        now = self.clock.now()
        with self._lock:
            job = case_to_job(case, now=now)
            self.jobs[job.id] = job
            self._plan = self.scheduler.replan(before, self.workers, list(self.jobs.values()), now)
            self.last_meta = {**self.scheduler.last_meta, "replanned_at": now.isoformat()}
            return self._plan, diff_plans(before, self._plan)

    def remove_case(self, case_id: str) -> tuple[Plan, dict]:
        """Drop a resolved/cancelled case's job and re-plan."""
        before = self.current_plan()
        with self._lock:
            self.jobs = {k: j for k, j in self.jobs.items() if j.case_id != case_id}
            self._plan = self.scheduler.replan(before, self.workers, list(self.jobs.values()), self.clock.now())
            return self._plan, diff_plans(before, self._plan)
