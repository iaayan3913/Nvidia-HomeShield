from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.schemas import Case, HazardType, Severity
from backend.service import HomeShieldService
from scheduler import get_scheduler
from scheduler import cuopt as cuopt_module
from scheduler import ortools as ortools_module
from scheduler.mock import MockScheduler
from store.sqlite import Store


def fixture_intake(text, photo_uri=None, audio_uri=None, property_id=None):
    return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=HazardType.damp_mould,
                severity=Severity.moderate, is_emergency=False, summary="Synthetic scheduler test",
                property_id=property_id or "p-001",
                created_at=datetime(2026, 11, 13, 9, tzinfo=timezone.utc))


def integration_service(tmp_path, scheduler=None, adapter="mock"):
    return HomeShieldService(Store(str(tmp_path / "schedule.sqlite3")),
                             scheduler or get_scheduler(adapter, 0.2),
                             intake=fixture_intake, intake_adapter="mock",
                             scheduler_adapter=adapter, scheduler_seed_jobs=False)


def test_mock_and_ortools_selection(tmp_path):
    mock = integration_service(tmp_path, adapter="mock")
    assert mock.scheduler_status()["chain"] == ["mock"]
    assert TestClient(create_app(mock)).post("/api/reports", json={"text": "mould"}).json()["plan"]["solver"] == "mock"

    if ortools_module.available():
        other = HomeShieldService(Store(str(tmp_path / "ortools.sqlite3")),
                                  get_scheduler("ortools", 0.2), intake=fixture_intake,
                                  intake_adapter="mock", scheduler_adapter="ortools",
                                  scheduler_seed_jobs=False)
        assert other.scheduler_status()["chain"][:2] == ["ortools", "mock"]
        response = TestClient(create_app(other)).post("/api/reports", json={"text": "mould"})
        assert response.status_code == 201 and response.json()["plan"]["solver"] == "ortools"


def test_cuopt_selection_is_explicit_without_claiming_execution(tmp_path):
    service = integration_service(tmp_path, scheduler=get_scheduler("cuopt", 0.1), adapter="cuopt")
    status = service.scheduler_status()
    assert status["requested"] == "cuopt" and status["chain"][-1] == "mock"
    if not cuopt_module.available():
        assert "cuopt" not in status["chain"]


def test_proposal_requires_approval_before_plan_activation_and_persists(tmp_path):
    service = integration_service(tmp_path)
    client = TestClient(create_app(service))
    response = client.post("/api/reports", json={"text": "mould", "property_id": "p-001"})
    assert response.status_code == 201
    body = response.json()
    proposed = body["plan"]
    assert proposed["approved"] is False
    assert client.get("/api/plans/active").status_code == 404
    stops = [stop for worker in proposed["workers"] for stop in worker["stops"]]
    assert stops and all(isinstance(stop["lat"], float) and isinstance(stop["lon"], float) for stop in stops)

    approved = client.post(f"/api/approvals/{body['approval']['id']}/approve",
                           json={"decided_by": "scheduler-officer"})
    assert approved.status_code == 200
    active = client.get("/api/plans/active").json()
    assert active["id"] == proposed["id"] and active["approved"] is True
    assert Store(str(tmp_path / "schedule.sqlite3")).latest_active_plan().id == proposed["id"]
    types = {event["type"] for event in client.get("/api/events").json()}
    assert {"plan.proposed", "plan.approved", "plan.activated"} <= types


def test_emergency_replan_remains_proposed_until_decision(tmp_path):
    service = integration_service(tmp_path)
    client = TestClient(create_app(service))
    ordinary = client.post("/api/reports", json={"text": "mould", "property_id": "p-001"}).json()
    client.post(f"/api/approvals/{ordinary['approval']['id']}/approve", json={"decided_by": "officer"})
    original_active = client.get("/api/plans/active").json()["id"]

    emergency = client.post("/api/emergency", json={"text": "gas smell", "property_id": "p-110"})
    assert emergency.status_code == 201
    revised = emergency.json()
    assert revised["plan"]["id"] != original_active and revised["plan"]["approved"] is False
    assert client.get("/api/plans/active").json()["id"] == original_active
    client.post(f"/api/approvals/{revised['approval']['id']}/reject",
                json={"decided_by": "officer", "reason": "Use another team"})
    assert client.get("/api/plans/active").json()["id"] == original_active

    second = client.post("/api/emergency", json={"text": "gas smell", "property_id": "p-111"}).json()
    client.post(f"/api/approvals/{second['approval']['id']}/approve", json={"decided_by": "officer"})
    assert client.get("/api/plans/active").json()["id"] == second["plan"]["id"]
    events = client.get("/api/events").json()
    types = {event["type"] for event in events}
    assert {"plan.replan_started", "plan.replan_completed", "plan.rejected", "plan.activated"} <= types
    completed = next(event for event in events if event["type"] == "plan.replan_completed")
    assert completed["payload"]["plan"]["workers"] and "changes" in completed["payload"]


def test_unassigned_jobs_and_scheduler_failures_are_explicit(tmp_path):
    service = integration_service(tmp_path)
    service.scheduling.workers = []
    client = TestClient(create_app(service))
    response = client.post("/api/reports", json={"text": "mould"})
    assert response.status_code == 201
    plan = response.json()["plan"]
    assert plan["unassigned_jobs"] and plan["conflicts"]
    assert "plan.conflicts" in {event["type"] for event in client.get("/api/events").json()}

    class BrokenScheduler:
        name = "broken"
        last_meta = {}

        def optimise_schedule(self, workers, jobs, initial_routes=None):
            raise TimeoutError("solver timeout")

        def replan(self, current, workers, jobs, now=None):
            raise TimeoutError("solver timeout")

    broken = integration_service(tmp_path / "broken", scheduler=BrokenScheduler(), adapter="broken")
    broken_client = TestClient(create_app(broken))
    failed = broken_client.post("/api/reports", json={"text": "mould"})
    assert failed.status_code == 503
    assert "scheduler could not produce a plan" in failed.json()["detail"]
    assert "plan.failed" in {event["type"] for event in broken_client.get("/api/events").json()}
