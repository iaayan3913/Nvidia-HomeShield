from datetime import datetime, timedelta
from backend.schemas import Case, Deadlines, Severity

def add_working_days(start: datetime, days: int) -> datetime:
    current = start
    remaining = days
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current

def compute_deadlines(case: Case, now: datetime | None = None) -> Deadlines:
    now = now or datetime.utcnow()
    if case.severity == Severity.emergency:
        return Deadlines(investigate_by=now + timedelta(hours=24), make_safe_by=now + timedelta(hours=24))
    if case.severity == Severity.significant:
        return Deadlines(investigate_by=add_working_days(now, 10), start_works_by=add_working_days(now, 15))
    return Deadlines(investigate_by=add_working_days(now, 10))
