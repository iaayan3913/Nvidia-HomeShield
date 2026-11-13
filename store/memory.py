from collections.abc import Iterator
from backend.schemas import AgentEvent, Case, Plan

CASES: dict[str, Case] = {}
EVENTS: list[AgentEvent] = []
LATEST_PLAN: Plan | None = None

def save_case(case: Case) -> Case:
    CASES[case.id] = case
    return case
def list_cases() -> list[Case]:
    return list(CASES.values())
def add_event(event: AgentEvent) -> AgentEvent:
    EVENTS.append(event)
    return event
def events_after(index: int) -> Iterator[AgentEvent]:
    yield from EVENTS[index:]
