import asyncio, json
from uuid import uuid4
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from backend.schemas import AgentEvent, ApprovalIn, CaseStatus, ReportIn, StatusIn
from intake.agent import analyse_report
from agent.orchestrator import process
from scheduler.mock import MockScheduler
from store import memory

app = FastAPI(title="HomeShield API")
@app.get("/health")
def health(): return {"status": "ok", "mocks": True}
@app.post("/api/reports")
def create_report(report: ReportIn):
    case = process(analyse_report(report.text, report.photo_uri, report.audio_uri, report.property_id))
    memory.add_event(AgentEvent(id=f"event-{uuid4().hex[:8]}", case_id=case.id, type="case.created", summary="Case created"))
    return {"case": case, "plan": memory.LATEST_PLAN}
@app.get("/api/cases")
def cases(): return memory.list_cases()
@app.get("/api/cases/{case_id}")
def case(case_id: str):
    if case_id not in memory.CASES: raise HTTPException(404, "Case not found")
    return memory.CASES[case_id]
@app.patch("/api/cases/{case_id}/status")
def status(case_id: str, update: StatusIn):
    if case_id not in memory.CASES: raise HTTPException(404, "Case not found")
    memory.CASES[case_id].status = update.status
    memory.add_event(AgentEvent(id=f"event-{uuid4().hex[:8]}", case_id=case_id, type="case.status_changed", summary=f"Status: {update.status}"))
    return memory.CASES[case_id]
@app.post("/api/cases/{case_id}/approve")
def approve(case_id: str, approval: ApprovalIn):
    if case_id not in memory.CASES: raise HTTPException(404, "Case not found")
    memory.CASES[case_id].status = CaseStatus.scheduled
    memory.add_event(AgentEvent(id=f"event-{uuid4().hex[:8]}", case_id=case_id, type="agent.event", summary="Human approval recorded", tool_name=approval.action))
    return memory.CASES[case_id]
@app.post("/api/cases/{case_id}/emergency")
def emergency(case_id: str, report: ReportIn):
    result = create_report(report)
    memory.LATEST_PLAN = MockScheduler().optimise_schedule([], [])
    memory.add_event(AgentEvent(id=f"event-{uuid4().hex[:8]}", case_id=case_id, type="plan.updated", summary="Emergency re-plan complete"))
    return result
@app.get("/api/plans/latest")
def latest_plan(): return memory.LATEST_PLAN
@app.get("/api/stream")
async def stream():
    async def events():
        index = 0
        while True:
            for event in memory.events_after(index):
                index += 1
                yield f"event: {event.type}\ndata: {json.dumps(event.model_dump(mode='json'))}\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(events(), media_type="text/event-stream")
