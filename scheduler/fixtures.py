"""Load scheduling fixtures and turn Cases into Jobs.

`load_workers()` / `load_jobs()` read data/generated/*.json, or generate the same
deterministic data in memory if the files are missing. Pass `day=` to rebase
the fixture day (2026-11-13) onto another date, e.g. `date.today()`.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from backend.schemas import Case, HazardType, Job, Severity, Skill, Worker

from .core import utcnow

GENERATED = Path(__file__).resolve().parents[1] / "data" / "generated"

HAZARD_SKILL = {HazardType.damp_mould: Skill.damp_mould, HazardType.leak: Skill.plumbing,
                HazardType.electrical: Skill.electrical, HazardType.gas: Skill.gas,
                HazardType.fire: Skill.fire, HazardType.other: Skill.general}
HAZARD_MINUTES = {HazardType.damp_mould: 90, HazardType.leak: 60, HazardType.electrical: 60,
                  HazardType.gas: 60, HazardType.fire: 45, HazardType.other: 45}
SEVERITY_PRIORITY = {Severity.routine: 1, Severity.moderate: 2, Severity.significant: 3, Severity.emergency: 5}
# Operational target for an emergency visit. This is a team choice, NOT the
# legal deadline (that comes from agent/rules.py). VERIFY with the team.
EMERGENCY_TARGET_MINUTES = 120


def _fixture_day() -> datetime:
    from data.sheffield import FIXTURE_DAY
    return FIXTURE_DAY


def _rebase(record: dict, keys: tuple[str, ...], day: date | None) -> dict:
    if day is None:
        return record
    delta = datetime.combine(day, datetime.min.time()) - _fixture_day()
    out = dict(record)
    for key in keys:
        if out.get(key):
            out[key] = (datetime.fromisoformat(out[key]) + delta).isoformat()
    return out


def _raw(name: str) -> list[dict]:
    path = GENERATED / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    if name == "workers":
        from data.generate_synthetic import generate_workers
        return generate_workers()
    if name == "jobs":
        from data.generate_synthetic import generate_jobs
        return generate_jobs()
    from data.generate_properties import generate_properties
    return generate_properties()


def load_workers(day: date | None = None) -> list[Worker]:
    allowed = set(Worker.model_fields)
    return [Worker(**{k: v for k, v in _rebase(w, ("shift_start", "shift_end"), day).items() if k in allowed})
            for w in _raw("workers")]


def load_jobs(day: date | None = None) -> list[Job]:
    allowed = set(Job.model_fields)
    return [Job(**{k: v for k, v in _rebase(j, ("earliest", "latest"), day).items() if k in allowed})
            for j in _raw("jobs")]


@lru_cache(maxsize=1)
def _property_index() -> dict[str, tuple[float, float]]:
    return {p["id"]: (p["lat"], p["lon"]) for p in _raw("properties")}


def property_location(property_id: str | None) -> tuple[float, float] | None:
    return _property_index().get(property_id) if property_id else None


def case_to_job(case: Case, now: datetime | None = None, lat: float | None = None, lon: float | None = None) -> Job:
    """Map a Case to a schedulable Job. Location comes from the property stock unless given."""
    now = now or utcnow()
    if lat is None or lon is None:
        location = property_location(case.property_id)
        if location is None:
            raise ValueError(f"case {case.id}: unknown property {case.property_id!r}; pass lat/lon")
        lat, lon = location
    deadline = case.deadlines.make_safe_by or case.deadlines.investigate_by or case.deadlines.start_works_by
    if case.is_emergency or case.severity == Severity.emergency:
        target = now + timedelta(minutes=EMERGENCY_TARGET_MINUTES)
        deadline = min(deadline, target) if deadline else target
    return Job(id=f"job-{case.id}", case_id=case.id, required_skill=HAZARD_SKILL.get(case.hazard_type, Skill.general),
               duration_minutes=HAZARD_MINUTES.get(case.hazard_type, 60), lat=lat, lon=lon,
               earliest=now, latest=deadline,
               priority=5 if case.is_emergency else SEVERITY_PRIORITY.get(case.severity, 1))


def demo_emergency_job(now: datetime, property_id: str = "p-110", skill: Skill = Skill.gas) -> Job:
    """Pitch script: "gas smell, flat in S2". p-110 is a synthetic low-rise flat in S2."""
    lat, lon = property_location(property_id) or (53.3700, -1.4500)
    return Job(id="job-emergency-demo", case_id="case-emergency-demo", required_skill=skill, duration_minutes=60,
               lat=lat, lon=lon, earliest=now, latest=now + timedelta(minutes=EMERGENCY_TARGET_MINUTES), priority=5)
