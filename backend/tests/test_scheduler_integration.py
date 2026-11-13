from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.schemas import Case, HazardType, Severity
from backend.service import HomeShieldService
import backend.service as service_module
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


def test_real_case_times_are_translated_to_demo_clock_without_changing_legal_dates(tmp_path, monkeypatch):
    real_now = [datetime(2026, 11, 13, 15, 30, tzinfo=timezone.utc)]
    demo_now = [datetime(2026, 11, 13, 11, 0)]

    def clocked_intake(text, photo_uri=None, audio_uri=None, property_id=None):
        gas = "gas" in text.lower()
        return Case(id=f"case-{uuid4().hex[:8]}",
                    hazard_type=HazardType.gas if gas else HazardType.damp_mould,
                    severity=Severity.emergency if gas else Severity.moderate,
                    is_emergency=gas, summary=text, property_id=property_id or "p-001",
                    created_at=real_now[0])

    service = HomeShieldService(Store(str(tmp_path / "clock-domain.sqlite3")), MockScheduler(),
                                intake=clocked_intake, intake_adapter="mock",
                                scheduler_adapter="mock", scheduler_seed_jobs=False)
    service.scheduling.clock.now = lambda: demo_now[0]
    monkeypatch.setattr(service_module, "utcnow", lambda: real_now[0].replace(tzinfo=None))
    client = TestClient(create_app(service))

    first = client.post("/api/emergency", json={"text": "gas smell at 15:30", "property_id": "p-110"})
    assert first.status_code == 201
    first_body = first.json()
    first_job = f"job-{first_body['case']['id']}"
    assert first_body["plan"] is not None and first_job not in first_body["plan"]["unassigned_jobs"]
    assigned = [(route["worker_id"], stop) for route in first_body["plan"]["workers"]
                for stop in route["stops"] if stop["job_id"] == first_job]
    assert assigned and assigned[0][0] in {
        worker.id for worker in service.scheduling.workers
        if HazardType.gas.value in {getattr(skill, "value", skill) for skill in worker.skills}
    }
    stored = service.store.get_case(first_body["case"]["id"])
    assert stored.created_at == real_now[0]
    assert stored.deadlines.investigate_by == real_now[0] + timedelta(hours=24)

    approved = client.post(f"/api/approvals/{first_body['approval']['id']}/approve",
                           json={"decided_by": "clock-test"})
    assert approved.status_code == 200

    # Wall time is now beyond gas workers' 16:00 fixture shift, while the demo
    # clock remains within it. The second emergency must still be feasible.
    real_now[0] = datetime(2026, 11, 13, 18, 15, tzinfo=timezone.utc)
    demo_now[0] = datetime(2026, 11, 13, 13, 45)
    second = client.post("/api/emergency", json={"text": "second gas emergency", "property_id": "p-111"})
    assert second.status_code == 201
    second_body = second.json()
    second_job = f"job-{second_body['case']['id']}"
    assert second_body["plan"] is not None and second_job not in second_body["plan"]["unassigned_jobs"]

    ordinary = client.post("/api/reports", json={"text": "ordinary mould report", "property_id": "p-002"})
    assert ordinary.status_code == 201 and ordinary.json()["plan"] is not None
    ordinary_approval = ordinary.json()["approval"]["id"]
    assert client.post(f"/api/approvals/{ordinary_approval}/approve",
                       json={"decided_by": "clock-test"}).status_code == 200
    assert client.get("/api/plans/active").json()["approved"] is True


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
    assert failed.status_code == 201
    body = failed.json()
    assert body["case"]["id"] and body["plan"] is None
    assert body["approval"]["action"] == "retry_schedule"
    assert broken.store.get_case(body["case"]["id"]) is not None
    events = broken_client.get("/api/events").json()
    failure = next(event for event in events if event["type"] == "plan.failed")
    assert failure["payload"]["recoverable"] is True
    assert failure["payload"]["error_type"] == "TimeoutError"


@pytest.mark.parametrize("adapter", ["mock", "ortools"])
def test_repeated_reports_approvals_and_next_day_emergency_without_restart(tmp_path, adapter, monkeypatch):
    if adapter == "ortools" and not ortools_module.available():
        pytest.skip("OR-Tools is not installed")
    current = [datetime(2026, 11, 13, 10, tzinfo=timezone.utc)]

    def timed_intake(text, photo_uri=None, audio_uri=None, property_id=None):
        return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=HazardType.damp_mould,
                    severity=Severity.significant, is_emergency=False, summary=text,
                    property_id=property_id or "p-001", created_at=current[0])

    service = HomeShieldService(Store(str(tmp_path / "long-running.sqlite3")),
                                get_scheduler(adapter, 0.2), intake=timed_intake,
                                intake_adapter="mock", scheduler_adapter=adapter,
                                scheduler_seed_jobs=False)
    service.scheduling.clock.now = lambda: current[0].replace(tzinfo=None)
    monkeypatch.setattr(service_module, "utcnow", lambda: current[0].replace(tzinfo=None))
    client = TestClient(create_app(service))
    for hour in (10, 13, 16):
        current[0] = datetime(2026, 11, 13, hour, tzinfo=timezone.utc)
        created = client.post("/api/reports", json={"text": f"mould report {hour}", "property_id": "p-001"})
        assert created.status_code == 201 and created.json()["plan"] is not None
        approval = created.json()["approval"]["id"]
        assert client.post(f"/api/approvals/{approval}/approve", json={"decided_by": "officer"}).status_code == 200

    current[0] = datetime(2026, 11, 14, 9, tzinfo=timezone.utc)
    emergency = client.post("/api/emergency", json={"text": "gas smell", "property_id": "p-110"})
    assert emergency.status_code == 201 and emergency.json()["case"]["is_emergency"] is True
    assert emergency.json()["plan"] is not None
    final = client.post("/api/reports", json={"text": "another mould report", "property_id": "p-002"})
    assert final.status_code == 201 and final.json()["case"]["id"]
    assert "plan.recovery_started" in {event["type"] for event in client.get("/api/events").json()}
