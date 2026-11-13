from __future__ import annotations

from threading import RLock
from uuid import uuid4

from agent.rules import compute_deadlines
from backend.config import (
    DATABASE_PATH, INTAKE_ADAPTER, INTAKE_AUDIO_ENABLED, SCHEDULER_ADAPTER,
    SCHEDULER_SEED_JOBS, SCHEDULER_TIME_LIMIT_S,
)
from backend.schemas import (
    AgentEvent, Approval, ApprovalStatus, Case, CasePatch, CaseStatus, DecisionIn, Evidence,
    HazardType, Plan, ReportIn, Severity, utc_now,
)
from intake.agent import analyse_report
from scheduler import diff_plans, get_scheduler, validate_plan
from scheduler.fixtures import case_to_job
from scheduler.service import SchedulingService
from store.sqlite import Store
from backend.uploads import StoredUpload, UploadStore


def _event_id() -> str:
    return f"event-{uuid4().hex}"


class HomeShieldService:
    def __init__(self, store: Store | None = None, scheduler=None, *, intake=None,
                 intake_adapter: str = INTAKE_ADAPTER, upload_store: UploadStore | None = None,
                 intake_audio_enabled: bool = INTAKE_AUDIO_ENABLED,
                 scheduler_adapter: str = SCHEDULER_ADAPTER,
                 scheduler_seed_jobs: bool = SCHEDULER_SEED_JOBS):
        self.store = store or Store(DATABASE_PATH)
        self.scheduler_adapter = scheduler_adapter
        self.scheduler = scheduler or get_scheduler(scheduler_adapter, SCHEDULER_TIME_LIMIT_S)
        self.scheduling = SchedulingService(scheduler=self.scheduler, seed_jobs=scheduler_seed_jobs)
        self.intake = intake or analyse_report
        self.intake_adapter = intake_adapter
        self.upload_store = upload_store or UploadStore()
        self.intake_audio_enabled = intake_audio_enabled
        self._decision_lock = RLock()

    def scheduler_status(self) -> dict:
        chain = getattr(self.scheduler, "chain", [self.scheduler])
        return {"requested": self.scheduler_adapter,
                "chain": [getattr(item, "name", type(item).__name__) for item in chain],
                "time_limit_s": SCHEDULER_TIME_LIMIT_S}

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
                               "audio": audio_status})
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
        self.emit("case.created", "Housing case created", case.id, payload={"severity": case.severity.value})
        deadline_event = "deadline.review_required" if case.deadlines.review_required else "deadline.calculated"
        self.emit(deadline_event, "Deadline policy evaluated", case.id,
                  payload={"verified": case.deadlines.verified, "phase": case.deadlines.policy_phase})

        plan = self.propose_plan(case.id, emergency=force_emergency or case.is_emergency)
        approval = self.request_approval(case.id, "commit_plan", {"plan_id": plan.id} if plan else {})
        if force_emergency or case.is_emergency:
            self.emit("emergency.created", "Potential emergency requires immediate human safety review", case.id,
                      payload={"safety_notice": "Review immediately; HomeShield has not contacted emergency services"})
        return case, plan, approval

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
        jobs = dict(self.scheduling.jobs)
        now = self.scheduling.clock.now()
        for case in self.store.list_cases():
            if case.status == CaseStatus.resolved:
                continue
            previous_property = case.property_id
            self.scheduling.resolve_property(case)
            if case.property_id != previous_property:
                self.store.save_case(case, "Scheduler assigned a synthetic demo property")
            job = case_to_job(case, now=now)
            jobs[job.id] = job
        return list(jobs.values())

    def propose_plan(self, case_id: str, *, emergency: bool = False) -> Plan:
        self.emit("agent.tool_requested", "Schedule proposal requested", case_id, tool_name="schedule_job")
        if emergency:
            self.emit("plan.replan_started", "Emergency schedule re-planning started", case_id,
                      payload={"active_plan_id": getattr(self.store.latest_active_plan(), "id", None)})
        try:
            active = self.store.latest_active_plan()
            jobs = self._jobs_for_proposal()
            now = self.scheduling.clock.now()
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
                      payload={"error_type": type(exc).__name__, "requested_adapter": self.scheduler_adapter})
            self.emit("agent.tool_failed", "Scheduling tool failed", case_id, tool_name="schedule_job", success=False,
                      payload={"error_type": type(exc).__name__})
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

