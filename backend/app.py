from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.concurrency import run_in_threadpool

from agent.rules import compute_deadlines
from agent.tools import TOOL_NAMES, TOOLS
from backend.config import AGENT_RUNTIME, CORS_ORIGINS, DEMO_SEED, SCHEDULER_ADAPTER, USE_MOCKS
from backend.schemas import ApprovalIn, Case, CasePatch, DecisionIn, EmergencyIn, ReportIn, StatusIn
from backend.service import HomeShieldService
from backend.uploads import UploadValidationError


def create_app(service: HomeShieldService | None = None) -> FastAPI:
    backend = service or HomeShieldService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if DEMO_SEED:
            backend.seed()
        yield

    api = FastAPI(title="HomeShield API", version="1.0.0", lifespan=lifespan)
    api.state.service = backend
    api.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @api.get("/health")
    def health():
        return {"status": "ok", "mocks": USE_MOCKS, "database": "sqlite",
                "scheduler": backend.scheduler_status(), "agent_runtime": AGENT_RUNTIME}

    async def report_response(report: ReportIn):
        try:
            case, plan, approval = await run_in_threadpool(backend.submit_report, report)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        warnings = [item.description for item in case.evidence
                    if item.description and "not analysed" in item.description]
        return {"case": case, "plan": plan, "approval": approval, "warnings": warnings}

    @api.post("/api/reports", status_code=201, openapi_extra={"requestBody": {"content": {
        "application/json": {"schema": ReportIn.model_json_schema()},
        "multipart/form-data": {"schema": {"type": "object", "required": ["text"], "properties": {
            "text": {"type": "string"}, "property_id": {"type": "string"},
            "photo": {"type": "string", "format": "binary"},
            "audio": {"type": "string", "format": "binary"}}}}}}})
    async def create_report(request: Request):
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type == "application/json":
            try:
                report = ReportIn.model_validate(await request.json())
            except (ValueError, ValidationError, json.JSONDecodeError) as exc:
                raise HTTPException(422, "Invalid JSON report") from exc
            return await report_response(report)
        if content_type != "multipart/form-data":
            raise HTTPException(415, "Use application/json or multipart/form-data")

        try:
            form = await request.form()
        except Exception as exc:
            raise HTTPException(400, "Invalid multipart request") from exc
        photo = form.get("photo")
        audio = form.get("audio")
        if photo is not None and not isinstance(photo, UploadFile):
            raise HTTPException(422, "photo must be an uploaded file")
        if audio is not None and not isinstance(audio, UploadFile):
            raise HTTPException(422, "audio must be an uploaded file")

        saved: list[str] = []
        try:
            photo_ref = None
            audio_ref = None
            if photo:
                stored_photo = await backend.upload_store.save(photo, "photo")
                photo_ref = stored_photo.reference
                saved.append(photo_ref)
            if audio:
                stored_audio = await backend.upload_store.save(audio, "audio")
                audio_ref = stored_audio.reference
                saved.append(audio_ref)
            report = ReportIn(text=str(form.get("text") or ""),
                              property_id=str(form["property_id"]) if form.get("property_id") else None,
                              photo_uri=photo_ref, audio_uri=audio_ref)
        except UploadValidationError as exc:
            for reference in saved:
                backend.upload_store.discard(reference)
            raise HTTPException(exc.status_code, str(exc)) from exc
        except ValidationError as exc:
            for reference in saved:
                backend.upload_store.discard(reference)
            raise HTTPException(422, "Invalid multipart report fields") from exc
        return await report_response(report)

    @api.post("/api/emergency", status_code=201)
    def create_emergency(report: EmergencyIn):
        try:
            case, plan, approval = backend.submit_report(report, force_emergency=True)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        return {"case": case, "plan": plan, "approval": approval,
                "safety_notice": "Potential emergency flagged for immediate human review; no emergency service was dispatched."}

    @api.post("/api/cases/{case_id}/emergency", status_code=201)
    def create_case_emergency(case_id: str, report: EmergencyIn):
        # Contract-compatible route: the supplied case is validated as the related case.
        try:
            backend.require_case(case_id)
        except KeyError as exc:
            raise HTTPException(404, "Case not found") from exc
        return create_emergency(report)

    @api.get("/api/cases")
    def list_cases():
        return backend.store.list_cases()

    @api.get("/api/cases/{case_id}")
    def get_case(case_id: str):
        try:
            return backend.require_case(case_id)
        except KeyError as exc:
            raise HTTPException(404, "Case not found") from exc

    @api.get("/api/cases/{case_id}/history")
    def get_case_history(case_id: str):
        get_case(case_id)
        return backend.store.case_history(case_id)

    @api.patch("/api/cases/{case_id}")
    def patch_case(case_id: str, update: CasePatch):
        try:
            return backend.patch_case(case_id, update)
        except KeyError as exc:
            raise HTTPException(404, "Case not found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @api.patch("/api/cases/{case_id}/status")
    def patch_status(case_id: str, update: StatusIn):
        return patch_case(case_id, CasePatch(status=update.status))

    @api.get("/api/plans")
    def list_plans():
        return backend.store.list_plans()

    @api.get("/api/plans/latest")
    def latest_plan():
        plan = backend.store.latest_plan()
        if not plan:
            raise HTTPException(404, "No plan available")
        return plan

    @api.get("/api/plans/active")
    def active_plan():
        plan = backend.store.latest_active_plan()
        if not plan:
            raise HTTPException(404, "No active plan available")
        return plan

    @api.get("/api/plans/{plan_id}")
    def get_plan(plan_id: str):
        plan = backend.store.get_plan(plan_id)
        if not plan:
            raise HTTPException(404, "Plan not found")
        return plan

    @api.get("/api/workers")
    def list_workers():
        return backend.scheduling.workers

    @api.get("/api/approvals")
    def list_approvals(status: str | None = Query(default=None, pattern="^(pending|approved|rejected)$")):
        return backend.store.list_approvals(status)

    def decide(approval_id: str, decision: DecisionIn, approved: bool):
        try:
            return backend.decide_approval(approval_id, decision, approved)
        except KeyError as exc:
            raise HTTPException(404, "Approval not found") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @api.post("/api/approvals/{approval_id}/approve")
    def approve(approval_id: str, decision: DecisionIn):
        return decide(approval_id, decision, True)

    @api.post("/api/approvals/{approval_id}/reject")
    def reject(approval_id: str, decision: DecisionIn):
        return decide(approval_id, decision, False)

    @api.post("/api/cases/{case_id}/approve")
    def approve_case(case_id: str, approval: ApprovalIn):
        get_case(case_id)
        pending = [item for item in backend.store.list_approvals("pending")
                   if item.case_id == case_id and item.action in {approval.action, "commit_plan"}]
        if not pending:
            raise HTTPException(404, "No pending approval for case")
        return decide(pending[0].id, DecisionIn(), True)

    @api.get("/api/events")
    def list_events(after: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=1000)):
        return [{"sequence": sequence, **event.model_dump(mode="json")}
                for sequence, event in backend.store.list_events(after, limit)]

    @api.get("/api/agent/tools")
    def agent_tools():
        return TOOLS

    @api.post("/api/agent/tools/{tool_name}")
    def agent_tool(tool_name: str, arguments: dict):
        case_id = arguments.get("case_id")
        if tool_name not in TOOL_NAMES:
            backend.emit("agent.tool_failed", "Agent requested an unknown tool", tool_name=tool_name, success=False)
            raise HTTPException(404, "Unknown agent tool")
        try:
            backend.emit("agent.tool_requested", "Agent tool requested", str(case_id) if case_id else None,
                         tool_name=tool_name)
            if tool_name == "create_case":
                created = Case.model_validate(arguments.get("case"))
                backend.store.save_case(created, "Created by approved agent tool")
                backend.emit("agent.tool_completed", "Case creation tool completed", created.id,
                             tool_name=tool_name, success=True)
                return created
            if tool_name == "get_case":
                return backend.require_case(str(case_id))
            if tool_name == "get_repair_history":
                backend.require_case(str(case_id))
                return backend.store.case_history(str(case_id))
            if tool_name == "compute_deadlines":
                case = backend.require_case(str(case_id))
                result = compute_deadlines(case)
                backend.emit("agent.tool_completed", "Deadline tool completed", case.id,
                             tool_name=tool_name, success=True)
                return result
            if tool_name == "schedule_job":
                return backend.propose_plan(str(case_id))
            if tool_name in {"request_approval", "notify_resident", "escalate"}:
                backend.require_case(str(case_id))
                action = arguments.get("action") or tool_name
                payload = {key: value for key, value in arguments.items() if key != "case_id"}
                return backend.request_approval(str(case_id), str(action), payload)
        except KeyError as exc:
            backend.emit("agent.tool_failed", "Agent tool target was not found", str(case_id),
                         tool_name=tool_name, success=False)
            raise HTTPException(404, "Case not found") from exc
        except (TypeError, ValueError) as exc:
            backend.emit("agent.tool_failed", "Agent tool arguments failed validation", str(case_id) if case_id else None,
                         tool_name=tool_name, success=False)
            raise HTTPException(422, "Invalid tool arguments") from exc

    @api.get("/api/stream")
    async def stream(request: Request, last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
                     once: bool = Query(default=False, description="Return currently available events then close")):
        try:
            cursor = max(0, int(last_event_id or 0))
        except ValueError:
            cursor = 0

        async def events():
            nonlocal cursor
            heartbeat = 0
            while not await request.is_disconnected():
                rows = backend.store.list_events(cursor, 100)
                if rows:
                    for sequence, event in rows:
                        cursor = sequence
                        data = json.dumps(event.model_dump(mode="json"), separators=(",", ":"))
                        yield f"id: {sequence}\nevent: {event.type}\ndata: {data}\n\n"
                    heartbeat = 0
                    if once:
                        return
                else:
                    if once:
                        return
                    heartbeat += 1
                    if heartbeat >= 15:
                        yield ": heartbeat\n\n"
                        heartbeat = 0
                await asyncio.sleep(1)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return api


app = create_app()
