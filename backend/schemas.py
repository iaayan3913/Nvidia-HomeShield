from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)


class HazardType(str, Enum):
    damp_mould = "damp_mould"
    leak = "leak"
    electrical = "electrical"
    gas = "gas"
    fire = "fire"
    other = "other"


class Severity(str, Enum):
    routine = "routine"
    moderate = "moderate"
    significant = "significant"
    emergency = "emergency"


class CaseStatus(str, Enum):
    new = "new"
    investigating = "investigating"
    awaiting_approval = "awaiting_approval"
    scheduled = "scheduled"
    in_progress = "in_progress"
    resolved = "resolved"
    escalated = "escalated"


class Skill(str, Enum):
    general = "general"
    damp_mould = "damp_mould"
    plumbing = "plumbing"
    electrical = "electrical"
    gas = "gas"
    fire = "fire"


class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class Evidence(APIModel):
    kind: str = Field(min_length=1, max_length=40)
    uri: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=500)


class Deadlines(APIModel):
    investigate_by: datetime | None = None
    make_safe_by: datetime | None = None
    start_works_by: datetime | None = None
    verified: bool = False
    review_required: bool = True
    policy_phase: str | None = None
    notes: list[str] = Field(default_factory=list)


class Case(APIModel):
    id: str = Field(min_length=1, max_length=100)
    hazard_type: HazardType
    hhsrs_category: str | None = Field(default=None, max_length=100)
    severity: Severity
    is_emergency: bool
    room: str | None = Field(default=None, max_length=100)
    vulnerable_occupants: list[str] = Field(default_factory=list)
    summary: str = Field(min_length=1, max_length=1000)
    evidence: list[Evidence] = Field(default_factory=list)
    deadlines: Deadlines = Field(default_factory=Deadlines)
    status: CaseStatus = CaseStatus.new
    property_id: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class Worker(APIModel):
    id: str
    name: str
    skills: list[Skill] = Field(default_factory=list)
    shift_start: datetime
    shift_end: datetime
    lat: float
    lon: float


class Job(APIModel):
    id: str
    case_id: str
    required_skill: Skill
    duration_minutes: int = Field(default=60, gt=0, le=1440)
    lat: float
    lon: float
    earliest: datetime | None = None
    latest: datetime | None = None
    priority: int = Field(default=1, ge=1)


class Stop(APIModel):
    job_id: str
    eta: datetime
    lat: float
    lon: float
    slack_minutes: int | None = None


class WorkerPlan(APIModel):
    worker_id: str
    stops: list[Stop] = Field(default_factory=list)


class Plan(APIModel):
    id: str
    solver: str
    solver_ms: float = Field(ge=0)
    workers: list[WorkerPlan] = Field(default_factory=list)
    unassigned_jobs: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    approved: bool = False


class AgentEvent(APIModel):
    id: str
    case_id: str | None = None
    type: str
    summary: str = Field(max_length=500)
    tool_name: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    success: bool | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Approval(APIModel):
    id: str
    case_id: str
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: ApprovalStatus = ApprovalStatus.pending
    requested_at: datetime = Field(default_factory=utc_now)
    decided_at: datetime | None = None
    decided_by: str | None = None
    outcome: str | None = None
    executed_at: datetime | None = None


class ReportIn(APIModel):
    text: str = Field(min_length=1, max_length=5000)
    photo_uri: str | None = Field(default=None, max_length=1000)
    audio_uri: str | None = Field(default=None, max_length=1000)
    property_id: str | None = Field(default=None, max_length=100)

    @field_validator("text")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("report text must not be blank")
        return value


class StatusIn(APIModel):
    status: CaseStatus


class CasePatch(APIModel):
    status: CaseStatus | None = None
    room: str | None = Field(default=None, max_length=100)
    property_id: str | None = Field(default=None, max_length=100)


class ApprovalIn(APIModel):
    action: str = "schedule_job"


class DecisionIn(APIModel):
    decided_by: str = Field(default="housing-officer", min_length=1, max_length=100)
    reason: str | None = Field(default=None, max_length=500)


class EmergencyIn(ReportIn):
    pass
