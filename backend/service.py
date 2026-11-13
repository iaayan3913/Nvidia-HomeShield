from __future__ import annotations

from functools import lru_cache
from threading import RLock
from uuid import uuid4

from agent.rules import compute_deadlines
from agent.orchestrator import AgentBackend, build_agent
from agent.tools import TOOL_NAMES
from backend.config import (
    AGENT_RUNTIME, DATABASE_PATH, INTAKE_ADAPTER, INTAKE_AUDIO_ENABLED, SCHEDULER_ADAPTER,
    SCHEDULER_ALLOW_FALLBACK, SCHEDULER_SEED_JOBS, SCHEDULER_TIME_LIMIT_S,
)
from backend.schemas import (
    AgentEvent, Approval, ApprovalStatus, Case, CasePatch, CaseStatus, DecisionIn, Evidence,
    HazardType, Plan, ReportIn, Severity, utc_now,
)
from intake.agent import analyse_report
from scheduler import diff_plans, get_scheduler, validate_plan
from scheduler.core import naive_utc, utcnow
from scheduler.fixtures import _raw, case_to_job, property_location
from scheduler.service import SchedulingService
from store.sqlite import Store
from backend.records import PrivateRecords
from backend.uploads import StoredUpload, UploadStore


def _event_id() -> str:
    return f"event-{uuid4().hex}"


class HomeShieldService:
    def __init__(self, store: Store | None = None, scheduler=None, *, intake=None,
                 intake_adapter: str = INTAKE_ADAPTER, upload_store: UploadStore | None = None,
                 intake_audio_enabled: bool = INTAKE_AUDIO_ENABLED,
                 scheduler_adapter: str = SCHEDULER_ADAPTER,
                 scheduler_seed_jobs: bool = SCHEDULER_SEED_JOBS,
                 agent_runtime: str = AGENT_RUNTIME, agent_backend: AgentBackend | None = None):
        self.store = store or Store(DATABASE_PATH)
        self.scheduler_adapter = scheduler_adapter
        self.scheduler = scheduler or get_scheduler(scheduler_adapter, SCHEDULER_TIME_LIMIT_S,
                                                     SCHEDULER_ALLOW_FALLBACK)
        self.scheduling = SchedulingService(scheduler=self.scheduler, seed_jobs=scheduler_seed_jobs)
        self.intake = intake or analyse_report
        self.intake_adapter = intake_adapter
        self.upload_store = upload_store or UploadStore()
        self.intake_audio_enabled = intake_audio_enabled
        self._decision_lock = RLock()
        self.records = PrivateRecords(self.store.path)
        self._agent_lock = RLock()
        self._agent_plans: dict[str, Plan] = {}
        self._agent_approvals: dict[str, Approval] = {}
        self.agent_runtime = agent_runtime.lower()
        self.agent = agent_backend or build_agent(self.execute_agent_tool, runtime=self.agent_runtime)

    def scheduler_status(self) -> dict:
        from scheduler.cuopt import status as cuopt_status
        chain = getattr(self.scheduler, "chain", [self.scheduler])
        return {"requested": self.scheduler_adapter,
                "chain": [getattr(item, "name", type(item).__name__) for item in chain],
                "time_limit_s": SCHEDULER_TIME_LIMIT_S,
                "allow_fallback": getattr(self.scheduler, "allow_fallback", SCHEDULER_ALLOW_FALLBACK),
                "cuopt": cuopt_status(),
                "unavailable": getattr(self.scheduler, "initial_failures", [])}

    def emit(self, event_type: str, summary: str, case_id: str | None = None,
             *, tool_name: str | None = None, payload: dict | None = None,
             success: bool | None = None) -> AgentEvent:
        event = AgentEvent(id=_event_id(), case_id=case_id, type=event_type, summary=summary,
                           tool_name=tool_name, payload=payload or {}, success=success)
        return self.store.add_event(event)

    def submit_report(self, report: ReportIn, *, force_emergency: bool = False) -> tuple[Case, Plan | None, Approval]:
        try:
            photo = self._stored_media(report.photo_uri, "photo")
            audio = self._stored_media(report.audio_uri, "audio")
            photo_input = str(photo.path) if photo and self.intake_adapter == "real" else report.photo_uri
            audio_input = report.audio_uri
            audio_status = "not_provided"
            if audio:
                if self.intake_adapter == "real" and self.intake_audio_enabled:
                    audio_input = str(audio.path)
                    audio_status = "submitted"
                elif self.intake_adapter == "real":
                    audio_input = None
                    audio_status = "stored_not_analysed"
                else:
                    audio_status = "stored_mock_only"
            try:
                case = self.intake(report.text, photo_input, audio_input, report.property_id)
            except Exception:
                if audio and self.intake_adapter == "real" and self.intake_audio_enabled:
                    # A confirmed text/photo result is preferable to losing the report when audio parts are unsupported.
                    case = self.intake(report.text, photo_input, None, report.property_id)
                    audio_status = "stored_audio_rejected_by_adapter"
                else:
                    raise
            if not isinstance(case, Case):
                case = Case.model_validate(case)
            self._normalise_evidence(case, photo, audio, audio_status)
            self.emit("intake.completed", "Report intake completed", case.id, success=True,
                      payload={"adapter": self.intake_adapter,
                               "photo": "submitted" if photo and self.intake_adapter == "real" else
                                        "stored_mock_only" if photo else "not_provided",
                               "audio": audio_status,
                               "hhsrs_category": case.hhsrs_category,
                               "classification_status": "professionally_confirmed" if case.hhsrs_category
                                                        else "unknown_pending_professional_review"})
            if audio_status in {"stored_not_analysed", "stored_audio_rejected_by_adapter"}:
                self.emit("intake.media_unavailable", "Audio was stored but not analysed", case.id,
                          payload={"media": "audio", "status": audio_status}, success=False)
        except Exception as exc:
            self.emit("agent.tool_failed", "Report intake failed validation", tool_name="analyse_report", success=False,
                      payload={"error_type": type(exc).__name__})
            raise ValueError(f"{self.intake_adapter} intake adapter could not produce a valid case "
                             f"({type(exc).__name__})") from exc

        if force_emergency:
            case.is_emergency = True
            case.severity = Severity.emergency
            case.hhsrs_category = None
        case.deadlines = compute_deadlines(case, now=case.created_at)
        case.status = CaseStatus.awaiting_approval
        self.store.save_case(case, "Case created and queued for approval")
        self._save_private_details(case.id, report)
        self.emit("case.created", "Housing case created", case.id, payload={"severity": case.severity.value})
        deadline_event = "deadline.review_required" if case.deadlines.review_required else "deadline.calculated"
        self.emit(deadline_event, "Deadline policy evaluated", case.id,
                  payload={"verified": case.deadlines.verified, "phase": case.deadlines.policy_phase})

        plan, approval = self.coordinate_case(case.id)
        if force_emergency or case.is_emergency:
            self.emit("emergency.created", "Potential emergency requires immediate human safety review", case.id,
                      payload={"safety_notice": "Review immediately; HomeShield has not contacted emergency services"})
        return case, plan, approval

    def coordinate_case(self, case_id: str) -> tuple[Plan | None, Approval]:
        """Run the configured bounded orchestrator after the case is safely stored."""
        self.emit("agent.run_started", "Configured agent coordination started", case_id,
                  payload={"runtime": self.agent_runtime})
        try:
            results = self.agent.run(case_id)
        except Exception as exc:
            results = [{"tool": "agent_runtime", "success": False,
                        "summary": f"Agent runtime failed ({type(exc).__name__})"}]
        for result in results:
            self.emit("agent.action_result", str(result.get("summary") or "Agent action completed"), case_id,
                      tool_name=str(result.get("tool") or "agent_runtime"),
                      payload={"runtime": self.agent_runtime}, success=bool(result.get("success")))
        with self._agent_lock:
            plan = self._agent_plans.pop(case_id, None)
            approval = self._agent_approvals.pop(case_id, None)
        if approval is None:
            action = "commit_plan" if plan else "retry_schedule"
            approval = self.request_approval(case_id, action, {"plan_id": plan.id} if plan else {
                "reason": "Agent or scheduler did not produce a proposal"
            })
        self.emit("agent.run_completed", "Agent coordination completed with human review preserved", case_id,
                  payload={"runtime": self.agent_runtime, "plan_id": getattr(plan, "id", None),
                           "approval_id": approval.id}, success=plan is not None)
        return plan, approval

    def execute_agent_tool(self, tool_name: str, arguments: dict) -> object:
        """Validated in-process tool interface shared by all configured agents."""
        if tool_name not in TOOL_NAMES:
            raise ValueError("unknown agent tool")
        case_id = str(arguments.get("case_id") or "")
        if tool_name == "create_case":
            created = Case.model_validate(arguments.get("case"))
            self.store.save_case(created, "Created by validated agent tool")
            return created
        if not case_id:
            raise ValueError("case_id is required")
        if tool_name == "get_case":
            return self.require_case(case_id)
        if tool_name == "get_repair_history":
            self.require_case(case_id)
            return self.store.case_history(case_id)
        if tool_name == "compute_deadlines":
            case = self.require_case(case_id)
            case.deadlines = compute_deadlines(case, now=case.created_at)
            self.store.save_case(case, "Compliance deadlines recalculated by agent tool")
            self.emit("agent.tool_completed", "Deadline tool completed", case_id,
                      tool_name=tool_name, success=True)
            return case.deadlines
        if tool_name == "schedule_job":
            case = self.require_case(case_id)
            plan = self.propose_plan(case_id, emergency=case.is_emergency)
            with self._agent_lock:
                self._agent_plans[case_id] = plan
            return plan
        if tool_name in {"request_approval", "notify_resident", "escalate"}:
            self.require_case(case_id)
            action = str(arguments.get("action") or tool_name)
            payload = {key: value for key, value in arguments.items() if key not in {"case_id", "action"}}
            with self._agent_lock:
                plan = self._agent_plans.get(case_id)
            if action in {"commit_plan", "schedule_job"}:
                if plan:
                    payload["plan_id"] = plan.id
                    action = "commit_plan"
                else:
                    raise ValueError("cannot request plan approval before scheduling succeeds")
            approval = self.request_approval(case_id, action, payload)
            with self._agent_lock:
                self._agent_approvals[case_id] = approval
            return approval
        raise ValueError("unsupported agent tool")

    def _stored_media(self, reference: str | None, kind: str) -> StoredUpload | None:
        if not reference:
            return None
        return self.upload_store.resolve(reference, kind)

    def _normalise_evidence(self, case: Case, photo: StoredUpload | None, audio: StoredUpload | None,
                            audio_status: str) -> None:
        for media in (photo, audio):
            if not media:
                continue
            if media.kind == "audio" and audio_status in {"stored_not_analysed", "stored_audio_rejected_by_adapter"}:
                processing = "audio processing unavailable; recording was not analysed"
            elif self.intake_adapter == "mock":
                processing = "mock intake; media was not analysed"
            else:
                processing = "submitted to configured intake adapter"
            description = f"{media.mime_type}, {media.size} bytes; {processing}"
            evidence = next((item for item in case.evidence if item.kind == media.kind), None)
            if evidence:
                evidence.uri = media.reference
                evidence.description = description
            else:
                case.evidence.append(Evidence(kind=media.kind, uri=media.reference, description=description))

    def _jobs_for_proposal(self) -> list:
        scheduler_now = self.scheduling.refresh_for_clock()
        # Persisted case/deadline timestamps remain real UTC. Only translate
        # the job's scheduling origin into the demo clock domain. With the
        # normal speed=1 clock this offset stays stable across long-running
        # processes, avoiding stale ETAs while keeping legal dates untouched.
        clock_offset = scheduler_now - utcnow()
        jobs = dict(self.scheduling.jobs)
        completed = {job_id for job_id, record in self.records.list_progress().items() if record["status"] == "completed"}
        jobs = {job_id: job for job_id, job in jobs.items() if job_id not in completed}
        for case in self.store.list_cases():
            if case.status == CaseStatus.resolved:
                continue
            previous_property = case.property_id
            self.scheduling.resolve_property(case)
            if case.property_id != previous_property:
                self.store.save_case(case, "Scheduler assigned a synthetic demo property")
            case_created = naive_utc(case.created_at)
            job = case_to_job(case, now=case_created + clock_offset)
            jobs[job.id] = job
        return list(jobs.values())

    def propose_plan(self, case_id: str, *, emergency: bool = False) -> Plan:
        self.emit("agent.tool_requested", "Schedule proposal requested", case_id, tool_name="schedule_job")
        if emergency:
            self.emit("plan.replan_started", "Emergency schedule re-planning started", case_id,
                      payload={"active_plan_id": getattr(self.store.latest_active_plan(), "id", None)})
        try:
            now = self.scheduling.refresh_for_clock()
            active = self.store.latest_active_plan()
            active_days = {stop.eta.date() for route in active.workers for stop in route.stops} if active else set()
            if active and active_days and active_days != {now.date()}:
                self.emit("plan.recovery_started", "Previous-day active plan was not warm-started", case_id,
                          payload={"active_plan_id": active.id, "operational_day": now.date().isoformat()})
                active = None
            jobs = self._jobs_for_proposal()
            if active:
                plan = self.scheduler.replan(active, self.scheduling.workers, jobs, now)
            else:
                plan = self.scheduler.optimise_schedule(self.scheduling.workers, jobs)
            plan = Plan.model_validate(plan)
            errors = validate_plan(plan, self.scheduling.workers, jobs)
            if errors:
                raise RuntimeError("scheduler returned an invalid plan: " + "; ".join(errors[:3]))
            plan.approved = False
            self.store.save_plan(plan)
            changes = diff_plans(active, plan)
            meta = {**getattr(self.scheduler, "last_meta", {}), **self.scheduler_status()}
            payload = {"plan_id": plan.id, "solver": plan.solver, "solver_ms": plan.solver_ms,
                       "unassigned_jobs": plan.unassigned_jobs, "conflicts": plan.conflicts,
                       "changes": changes, "scheduler": meta, "plan": plan.model_dump(mode="json")}
            self.emit("plan.proposed", "Schedule proposal created", case_id,
                      tool_name="schedule_job", payload=payload, success=True)
            if emergency:
                self.emit("plan.replan_completed", "Emergency schedule re-planning completed", case_id,
                          payload=payload, success=True)
                self.emit("plan.updated", "Emergency schedule proposal updated", case_id,
                          payload=payload, success=True)
            if plan.unassigned_jobs or plan.conflicts:
                self.emit("plan.conflicts", "Schedule proposal contains unassigned jobs or conflicts", case_id,
                          payload={"plan_id": plan.id, "unassigned_jobs": plan.unassigned_jobs,
                                   "conflicts": plan.conflicts}, success=False)
            self.emit("agent.tool_completed", "Scheduling tool completed", case_id, tool_name="schedule_job", success=True)
            return plan
        except Exception as exc:
            self.emit("plan.failed", "Scheduling failed", case_id, success=False,
                      payload={"error_type": type(exc).__name__, "error": str(exc)[:500],
                               "requested_adapter": self.scheduler_adapter,
                               "recoverable": True})
            self.emit("agent.tool_failed", "Scheduling tool failed", case_id, tool_name="schedule_job", success=False,
                      payload={"error_type": type(exc).__name__, "error": str(exc)[:500],
                               "recoverable": True})
            raise RuntimeError("scheduler could not produce a plan") from exc

    def request_approval(self, case_id: str, action: str, payload: dict | None = None) -> Approval:
        approval = self.store.request_approval(Approval(id=f"approval-{uuid4().hex}", case_id=case_id,
                                                        action=action, payload=payload or {}))
        self.emit("approval.requested", "Human approval requested", case_id,
                  tool_name="request_approval", payload={"approval_id": approval.id, "action": action})
        return approval

    def decide_approval(self, approval_id: str, decision: DecisionIn, approve: bool) -> Approval:
        with self._decision_lock:
            approval = self.store.get_approval(approval_id)
            if not approval:
                raise KeyError("approval not found")
            if approval.status != ApprovalStatus.pending:
                return approval
            approval.status = ApprovalStatus.approved if approve else ApprovalStatus.rejected
            approval.decided_at = utc_now()
            approval.decided_by = decision.decided_by
            approval.outcome = decision.reason or ("Approved" if approve else "Rejected")
            if approve:
                self._execute_approval(approval)
            self.store.save_approval(approval)
            if not approve and approval.action in {"commit_plan", "schedule_job"}:
                self.emit("plan.rejected", "Schedule proposal rejected", approval.case_id,
                          payload={"plan_id": approval.payload.get("plan_id"),
                                   "approval_id": approval.id}, success=False)
            self.emit("approval.approved" if approve else "approval.rejected",
                      "Human approval recorded", approval.case_id,
                      payload={"approval_id": approval.id, "action": approval.action})
            return approval

    def _execute_approval(self, approval: Approval) -> None:
        if approval.executed_at:
            return
        case = self.require_case(approval.case_id)
        if approval.action in {"commit_plan", "schedule_job"}:
            plan_id = approval.payload.get("plan_id")
            plan = self.store.get_plan(plan_id) if plan_id else self.store.latest_plan()
            if not plan:
                raise ValueError("proposed plan not found")
            plan.approved = True
            self.store.save_plan(plan)
            plan_payload = {"plan_id": plan.id, "solver": plan.solver, "solver_ms": plan.solver_ms,
                            "plan": plan.model_dump(mode="json")}
            self.emit("plan.approved", "Schedule proposal approved", case.id,
                      payload=plan_payload, success=True)
            self.emit("plan.activated", "Approved schedule is now active", case.id,
                      payload=plan_payload, success=True)
            case.status = CaseStatus.scheduled
            self.store.save_case(case, "Schedule approved")
            self.emit("case.status_changed", "Case schedule approved", case.id,
                      payload={"status": case.status.value})
        elif approval.action == "retry_schedule":
            plan = self.propose_plan(case.id, emergency=case.is_emergency)
            follow_up = self.request_approval(case.id, "commit_plan", {"plan_id": plan.id})
            approval.outcome = f"Scheduling retried; proposal {plan.id} awaits approval {follow_up.id}"
        elif approval.action == "escalate":
            case.status = CaseStatus.escalated
            self.store.save_case(case, "Escalation approved")
        elif approval.action == "notify_resident":
            # Integration seam only: no message is sent by the prototype.
            approval.outcome = "Approved; notification adapter not configured"
        else:
            raise ValueError("unsupported approval action")
        approval.executed_at = utc_now()

    def require_case(self, case_id: str) -> Case:
        case = self.store.get_case(case_id)
        if not case:
            raise KeyError("case not found")
        return case

    def patch_case(self, case_id: str, update: CasePatch) -> Case:
        case = self.require_case(case_id)
        changes = update.model_dump(exclude_unset=True)
        if changes.get("status") in {CaseStatus.scheduled, CaseStatus.in_progress, CaseStatus.escalated}:
            raise ValueError("consequential status changes require an approved action")
        for field, value in changes.items():
            setattr(case, field, value)
        self.store.save_case(case, "Case updated")
        self.emit("case.status_changed" if "status" in changes else "case.updated", "Case updated", case.id,
                  payload={"fields": sorted(changes)})
        return case

    def seed(self) -> int:
        if self.store.get_case("case-seed-mould"):
            return 0
        case = Case(id="case-seed-mould", hazard_type=HazardType.damp_mould,
                    hhsrs_category="damp_and_mould", severity=Severity.significant, is_emergency=False,
                    summary="Synthetic damp and mould demonstration case", property_id="p-seed-001")
        case.deadlines = compute_deadlines(case, now=case.created_at)
        self.store.save_case(case, "Synthetic demo seed")
        self.emit("case.created", "Synthetic demo case seeded", case.id)
        return 1


    # ---- Round 2 platform additions (additive) -------------------------------------------------

    def _save_private_details(self, case_id: str, report: ReportIn) -> None:
        details: dict = {}
        if report.contact:
            details["contact"] = report.contact.model_dump(exclude_none=True)
        if report.address_line or report.postcode:
            details["address"] = {"address_line": report.address_line, "postcode": report.postcode}
        if details:
            self.records.save_contact(case_id, details)

    def list_properties(self, query: str = "", limit: int = 50) -> list[dict]:
        items = _property_register()
        q = query.strip().lower()
        if q:
            first = q.split()[0]
            items = tuple(p for p in items if p["district"].lower() == first or p["id"].lower() == q
                          or q in p["area"].lower() or q in p["display_address"].lower())
        return list(items[:limit])

    def public_case(self, case_id: str) -> dict:
        """Resident-safe view: no evidence references, occupants or classification internals."""
        data = self.require_case(case_id).model_dump(mode="json")
        return {key: data[key] for key in PUBLIC_CASE_FIELDS}

    def list_jobs(self) -> list[dict]:
        active = self.store.latest_active_plan()
        assigned = {stop.job_id for route in active.workers for stop in route.stops} if active else set()
        progress = self.records.list_progress()
        seeds = {item["id"]: item for item in _seed_jobs()}
        known: dict[str, tuple] = {}
        for job in self.scheduling.jobs.values():
            seed = seeds.get(job.id, {})
            known[job.id] = (job, {"property_id": seed.get("property_id"), "hazard_type": seed.get("hazard_type"),
                                   "severity": seed.get("severity"), "source": "planned", "access_notes": None})
        for case in self.store.list_cases():
            if not property_location(case.property_id):
                self.scheduling.resolve_property(case)  # deterministic; not saved here
            try:
                # Same demo-clock translation as _jobs_for_proposal, so listed windows match planned ones.
                job = case_to_job(case, now=naive_utc(case.created_at) + (self.scheduling.clock.now() - utcnow()))
            except ValueError:
                continue
            contact = (self.records.get_contact(case.id) or {}).get("contact", {})
            known[job.id] = (job, {"property_id": case.property_id, "hazard_type": case.hazard_type.value,
                                   "severity": case.severity.value, "source": "case",
                                   "access_notes": contact.get("access_notes")})
        result = []
        for job_id, (job, meta) in known.items():
            record = progress.get(job_id)
            status = record["status"] if record else "assigned" if job_id in assigned else "unassigned"
            result.append({**job.model_dump(mode="json"), **meta, "status": status,
                           "completion_notes": record["notes"] if record else None,
                           "evidence_count": record["evidence_count"] if record else None,
                           "updated_at": record["updated_at"] if record else None})
        return result

    def record_job_progress(self, job_id: str, status: str, notes: str | None, evidence_count: int | None) -> dict:
        with self._decision_lock:
            job = next((item for item in self.list_jobs() if item["id"] == job_id), None)
            if not job:
                raise KeyError("job not found")
            if job["status"] == "unassigned":
                raise ValueError("This job is not on the approved active schedule")
            if status not in JOB_TRANSITIONS.get(job["status"], set()):
                raise ValueError(f"A job cannot move from {job['status']} to {status}")
            record = self.records.save_progress(job_id, job["case_id"], status, notes, evidence_count)
            case = self.store.get_case(job["case_id"])
            new_status = {"on_site": CaseStatus.in_progress, "completed": CaseStatus.resolved}.get(status)
            if case and new_status and case.status != new_status:
                case.status = new_status
                self.store.save_case(case, f"Operative marked the job {status.replace('_', ' ')}")
                self.emit("case.status_changed", "Case updated from operative progress", case.id,
                          payload={"status": new_status.value})
            # Notes stay private to /api/jobs; the event carries only safe identifiers.
            self.emit("job.progress", f"Operative marked a job {status.replace('_', ' ')}",
                      case.id if case else None, payload={"job_id": job_id, "status": status})
            return {**job, "status": status, "completion_notes": notes, "evidence_count": evidence_count,
                    "updated_at": record["updated_at"]}

    def latest_event_sequence(self) -> int:
        with self.store.lock:
            return int(self.store.connection.execute("SELECT COALESCE(MAX(sequence),0) FROM events").fetchone()[0])

    def reset(self) -> None:
        """Development-only: delete every case, plan, approval, event and private record."""
        with self._decision_lock:
            with self.store.transaction() as db:
                for table in ("case_history", "approvals", "plans", "cases", "events"):
                    db.execute(f"DELETE FROM {table}")
            self.records.clear()
            with self._agent_lock:
                self._agent_plans.clear()
                self._agent_approvals.clear()
            self.scheduling._plan = None
        self.emit("system.reset", "Development data was reset")


JOB_TRANSITIONS = {
    "assigned": {"travelling", "on_site", "unable_to_complete"},
    "travelling": {"on_site", "unable_to_complete"},
    "on_site": {"completed", "unable_to_complete"},
    "unable_to_complete": {"travelling", "on_site"},  # return visit, e.g. after collecting parts
}
PUBLIC_CASE_FIELDS = ("id", "hazard_type", "severity", "is_emergency", "status", "summary", "room",
                      "deadlines", "property_id", "created_at", "updated_at")


@lru_cache(maxsize=1)
def _seed_jobs() -> tuple[dict, ...]:
    return tuple(_raw("jobs"))


@lru_cache(maxsize=1)
def _property_register() -> tuple[dict, ...]:
    # The register is sample stock: it has an area and postcode district but no street address.
    return tuple({"id": p["id"], "display_address": f"Home {p['id']}, {p['area']}", "postcode": p["district"],
                  "district": p["district"], "area": p["area"], "lat": p["lat"], "lon": p["lon"],
                  "archetype": p["archetype"], "floors": p["floors"], "bedrooms": p["bedrooms"], "synthetic": True}
                 for p in _raw("properties"))
