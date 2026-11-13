from __future__ import annotations

from datetime import timedelta
from threading import RLock
from uuid import uuid4

from agent.rules import compute_deadlines
from backend.config import DATABASE_PATH, SCHEDULER_ADAPTER
from backend.schemas import (
    AgentEvent, Approval, ApprovalStatus, Case, CasePatch, CaseStatus, DecisionIn,
    HazardType, Job, Plan, ReportIn, Severity, Skill, Worker, utc_now,
)
from intake.agent import analyse_report
from scheduler.cuopt import CuOptScheduler
from scheduler.mock import MockScheduler
from scheduler.ortools import OrToolsScheduler
from store.sqlite import Store


def _event_id() -> str:
    return f"event-{uuid4().hex}"


def _skill(case: Case) -> Skill:
    return {
        HazardType.damp_mould: Skill.damp_mould,
        HazardType.leak: Skill.plumbing,
        HazardType.electrical: Skill.electrical,
        HazardType.gas: Skill.gas,
        HazardType.fire: Skill.fire,
    }.get(case.hazard_type, Skill.general)


class HomeShieldService:
    def __init__(self, store: Store | None = None, scheduler=None):
        self.store = store or Store(DATABASE_PATH)
        self.scheduler = scheduler or self._scheduler()
        self._decision_lock = RLock()

    @staticmethod
    def _scheduler():
        if SCHEDULER_ADAPTER == "cuopt":
            return CuOptScheduler()
        if SCHEDULER_ADAPTER == "ortools":
            return OrToolsScheduler()
        return MockScheduler()

    def emit(self, event_type: str, summary: str, case_id: str | None = None,
             *, tool_name: str | None = None, payload: dict | None = None,
             success: bool | None = None) -> AgentEvent:
        event = AgentEvent(id=_event_id(), case_id=case_id, type=event_type, summary=summary,
                           tool_name=tool_name, payload=payload or {}, success=success)
        return self.store.add_event(event)

    def submit_report(self, report: ReportIn, *, force_emergency: bool = False) -> tuple[Case, Plan | None, Approval]:
        try:
            case = analyse_report(report.text, report.photo_uri, report.audio_uri, report.property_id)
            if not isinstance(case, Case):
                case = Case.model_validate(case)
            self.emit("intake.completed", "Report intake completed", case.id, success=True)
        except Exception as exc:
            self.emit("agent.tool_failed", "Report intake failed validation", tool_name="analyse_report", success=False,
                      payload={"error_type": type(exc).__name__})
            raise ValueError("intake adapter could not produce a valid case") from exc

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

    def _workers(self) -> list[Worker]:
        now = utc_now()
        return [
            Worker(id="worker-general", name="Demo General Team", skills=[Skill.general, Skill.damp_mould, Skill.plumbing],
                   shift_start=now, shift_end=now + timedelta(hours=8), lat=53.3811, lon=-1.4701),
            Worker(id="worker-safety", name="Demo Safety Team", skills=[Skill.gas, Skill.fire, Skill.electrical],
                   shift_start=now, shift_end=now + timedelta(hours=8), lat=53.385, lon=-1.465),
        ]

    def _jobs(self) -> list[Job]:
        jobs: list[Job] = []
        for case in self.store.list_cases():
            if case.status in {CaseStatus.resolved, CaseStatus.in_progress}:
                continue
            # Coordinates are operational placeholders for the replaceable scheduler fixture, not resident data.
            jobs.append(Job(id=f"job-{case.id}", case_id=case.id, required_skill=_skill(case),
                            lat=53.38, lon=-1.47, earliest=utc_now(), latest=case.deadlines.investigate_by,
                            priority=100 if case.is_emergency else 10 if case.severity == Severity.significant else 1))
        return jobs

    def propose_plan(self, case_id: str, *, emergency: bool = False) -> Plan:
        self.emit("agent.tool_requested", "Schedule proposal requested", case_id, tool_name="schedule_job")
        try:
            plan = self.scheduler.optimise_schedule(self._workers(), self._jobs())
            plan = Plan.model_validate(plan)
            self.store.save_plan(plan)
            self.emit("plan.updated" if emergency else "plan.proposed", "Schedule proposal created", case_id,
                      tool_name="schedule_job", payload={"plan_id": plan.id, "solver": plan.solver,
                                                         "unassigned_jobs": plan.unassigned_jobs}, success=True)
            self.emit("agent.tool_completed", "Scheduling tool completed", case_id, tool_name="schedule_job", success=True)
            return plan
        except Exception as exc:
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
            plan = next((item for item in self.store.list_plans() if item.id == plan_id), self.store.latest_plan())
            if plan:
                plan.approved = True
                self.store.save_plan(plan)
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

