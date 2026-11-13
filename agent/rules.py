"""Deterministic policy calculations. This module never asks a model for deadlines."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from backend.config import RULES_PATH
from backend.schemas import Case, Deadlines, HazardType, Severity

LONDON = ZoneInfo("Europe/London")


@lru_cache(maxsize=8)
def load_rules(path: str = RULES_PATH) -> dict:
    with Path(path).open("r", encoding="utf-8") as handle:
        rules = yaml.safe_load(handle)
    if not isinstance(rules, dict) or "phases" not in rules:
        raise ValueError("deadline rules file has no phases")
    return rules


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def configured_bank_holidays(rules: dict | None = None) -> set[date]:
    values = (rules or load_rules()).get("england_wales_bank_holidays", [])
    return {date.fromisoformat(str(item)) for item in values}


def add_working_days(start: datetime, days: int, bank_holidays: set[date] | None = None) -> datetime:
    """Add working days; day one is the day after the triggering event."""
    if days < 0:
        raise ValueError("days cannot be negative")
    current = _aware(start)
    holidays = configured_bank_holidays() if bank_holidays is None else bank_holidays
    remaining = days
    while remaining:
        current += timedelta(days=1)
        local_date = current.astimezone(LONDON).date()
        if current.astimezone(LONDON).weekday() < 5 and local_date not in holidays:
            remaining -= 1
    return current


def _phase_for(when: datetime, rules: dict) -> dict | None:
    local_day = _aware(when).astimezone(LONDON).date()
    matching = [phase for phase in rules["phases"] if date.fromisoformat(str(phase["effective_from"])) <= local_day]
    return matching[-1] if matching else None


def compute_deadlines(
    case: Case,
    now: datetime | None = None,
    *,
    investigation_concluded_at: datetime | None = None,
    rules: dict | None = None,
) -> Deadlines:
    rules = rules or load_rules()
    known_at = _aware(now or datetime.now(timezone.utc))
    phase = _phase_for(known_at, rules)
    if not phase:
        return Deadlines(notes=["VERIFY: no policy phase applies on this date"], review_required=True)

    notes: list[str] = []
    classification_confirmed = bool(case.hhsrs_category)
    phase_name = str(phase["name"])

    if case.is_emergency or case.severity == Severity.emergency:
        hours = int(rules["emergency"]["investigate_hours"])
        due = known_at + timedelta(hours=hours)
        if not classification_confirmed:
            notes.append("Potential emergency: competent-person classification required; immediate safety review must not wait")
        return Deadlines(
            investigate_by=due,
            make_safe_by=known_at + timedelta(hours=int(rules["emergency"]["make_safe_hours"])),
            verified=classification_confirmed,
            review_required=not classification_confirmed,
            policy_phase=phase_name,
            notes=notes,
        )

    if case.severity != Severity.significant:
        return Deadlines(
            policy_phase=phase_name,
            notes=["No statutory significant/emergency classification supplied; professional review required"],
            review_required=True,
        )

    covered = {str(item) for item in phase.get("significant_hazards", [])}
    hazard_key = case.hazard_type.value
    if hazard_key not in covered:
        return Deadlines(
            policy_phase=phase_name,
            notes=[f"VERIFY: {hazard_key} is not a covered significant hazard in {phase_name}"],
            review_required=True,
        )

    investigate = add_working_days(known_at, int(rules["significant"]["investigate_working_days"]))
    works = None
    if investigation_concluded_at:
        works = add_working_days(
            _aware(investigation_concluded_at),
            int(rules["significant"]["safety_work_working_days_after_investigation"]),
        )
    else:
        notes.append("Safety-work deadline starts when the investigation concludes and is not yet calculable")
    if not classification_confirmed:
        notes.append("Potential significant hazard: classification requires competent professional review")
    return Deadlines(
        investigate_by=investigate,
        start_works_by=works,
        verified=classification_confirmed,
        review_required=not classification_confirmed,
        policy_phase=phase_name,
        notes=notes,
    )
