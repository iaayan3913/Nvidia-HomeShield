from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field

class HazardType(str, Enum):
    damp_mould = "damp_mould"; leak = "leak"; electrical = "electrical"; gas = "gas"; fire = "fire"; other = "other"
class Severity(str, Enum):
    routine = "routine"; moderate = "moderate"; significant = "significant"; emergency = "emergency"
class CaseStatus(str, Enum):
    new = "new"; investigating = "investigating"; awaiting_approval = "awaiting_approval"; scheduled = "scheduled"; in_progress = "in_progress"; resolved = "resolved"; escalated = "escalated"
class Skill(str, Enum):
    general = "general"; damp_mould = "damp_mould"; plumbing = "plumbing"; electrical = "electrical"; gas = "gas"; fire = "fire"

class Evidence(BaseModel):
    kind: str
    uri: str | None = None
    description: str | None = None
class Deadlines(BaseModel):
    investigate_by: datetime | None = None
    make_safe_by: datetime | None = None
    start_works_by: datetime | None = None
class Case(BaseModel):
    id: str
    hazard_type: HazardType
    hhsrs_category: str | None = None
    severity: Severity
    is_emergency: bool
    room: str | None = None
    vulnerable_occupants: list[str] = Field(default_factory=list)
    summary: str
    evidence: list[Evidence] = Field(default_factory=list)
    deadlines: Deadlines = Field(default_factory=Deadlines)
    status: CaseStatus = CaseStatus.new
    property_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
class Worker(BaseModel):
    id: str; name: str; skills: list[Skill] = Field(default_factory=list)
    shift_start: datetime; shift_end: datetime; lat: float; lon: float
class Job(BaseModel):
    id: str; case_id: str; required_skill: Skill; duration_minutes: int = 60
    lat: float; lon: float; earliest: datetime | None = None; latest: datetime | None = None; priority: int = 1
class Stop(BaseModel):
    job_id: str; eta: datetime; lat: float; lon: float; slack_minutes: int | None = None
class WorkerPlan(BaseModel):
    worker_id: str; stops: list[Stop] = Field(default_factory=list)
class Plan(BaseModel):
    id: str; solver: str; solver_ms: float; workers: list[WorkerPlan] = Field(default_factory=list)
    unassigned_jobs: list[str] = Field(default_factory=list); conflicts: list[str] = Field(default_factory=list)
class AgentEvent(BaseModel):
    id: str; case_id: str | None = None; type: str; summary: str; tool_name: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict); created_at: datetime = Field(default_factory=datetime.utcnow)
class ReportIn(BaseModel):
    text: str = ""; photo_uri: str | None = None; audio_uri: str | None = None; property_id: str | None = None
class StatusIn(BaseModel):
    status: CaseStatus
class ApprovalIn(BaseModel):
    action: str = "schedule_job"
