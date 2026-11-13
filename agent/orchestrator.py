from backend.schemas import AgentEvent, CaseStatus
from .rules import compute_deadlines
from store.memory import add_event, save_case
from uuid import uuid4
def process(case):
    case.deadlines = compute_deadlines(case)
    case.status = CaseStatus.awaiting_approval
    save_case(case)
    add_event(AgentEvent(id=f"event-{uuid4().hex[:8]}", case_id=case.id, type="tool_result",
                         summary="Deadlines computed; approval required", tool_name="compute_deadlines"))
    return case
