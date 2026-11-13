from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from agent.orchestrator import PythonToolAgent
from agent.rules import add_working_days, compute_deadlines
from backend.app import create_app
from backend.schemas import Case, HazardType, ReportIn, Severity
from backend.service import HomeShieldService
from scheduler.mock import MockScheduler
from store.sqlite import Store


def make_service(tmp_path):
    return HomeShieldService(Store(str(tmp_path / "test.sqlite3")), MockScheduler())


def test_health_docs_and_invalid_report(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    assert client.get("/health").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.post("/api/reports", json={"text": "  "}).status_code == 422


def test_report_case_retrieval_patch_and_events(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    response = client.post("/api/reports", json={"text": "Water leak under sink", "property_id": "p-1"})
    assert response.status_code == 201
    body = response.json()
    case_id = body["case"]["id"]
    assert body["case"]["status"] == "awaiting_approval"
    assert body["plan"]["solver"] == "mock"
    assert body["approval"]["status"] == "pending"
    assert client.get(f"/api/cases/{case_id}").status_code == 200
    changed = client.patch(f"/api/cases/{case_id}", json={"room": "kitchen"})
    assert changed.json()["room"] == "kitchen"
    assert client.patch(f"/api/cases/{case_id}", json={"status": "scheduled"}).status_code == 409
    assert len(client.get(f"/api/cases/{case_id}/history").json()) >= 1
    assert client.get("/api/events").json()


def test_sqlite_persists_cases_events_and_approvals(tmp_path):
    path = str(tmp_path / "persistent.sqlite3")
    first = HomeShieldService(Store(path), MockScheduler())
    case, _, approval = first.submit_report(ReportIn(text="Black mould", property_id="p-2"))
    first.store.close()
    second = Store(path)
    assert second.get_case(case.id) is not None
    assert second.get_approval(approval.id) is not None
    assert second.list_events()


def test_seed_is_idempotent(tmp_path):
    service = make_service(tmp_path)
    assert service.seed() == 1
    assert service.seed() == 0
    assert len(service.store.list_cases()) == 1


def test_approval_executes_once_and_rejection_does_not_execute(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    first = client.post("/api/reports", json={"text": "Mould in bedroom"}).json()
    approval_id = first["approval"]["id"]
    approved = client.post(f"/api/approvals/{approval_id}/approve", json={"decided_by": "officer-1"})
    assert approved.json()["executed_at"] is not None
    assert client.get(f"/api/cases/{first['case']['id']}").json()["status"] == "scheduled"
    repeated = client.post(f"/api/approvals/{approval_id}/approve", json={"decided_by": "officer-1"})
    assert repeated.json()["executed_at"] == approved.json()["executed_at"]

    second = client.post("/api/reports", json={"text": "Socket is sparking"}).json()
    rejected = client.post(f"/api/approvals/{second['approval']['id']}/reject",
                           json={"decided_by": "officer-1", "reason": "Needs inspection"})
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["executed_at"] is None
    assert client.get(f"/api/cases/{second['case']['id']}").json()["status"] == "awaiting_approval"


def test_deadline_weekends_bank_holidays_and_emergency():
    friday = datetime(2026, 11, 13, 12, tzinfo=timezone.utc)
    assert add_working_days(friday, 1).date().isoformat() == "2026-11-16"
    christmas_eve = datetime(2026, 12, 24, 12, tzinfo=timezone.utc)
    assert add_working_days(christmas_eve, 1).date().isoformat() == "2026-12-29"
    emergency = Case(id="e", hazard_type=HazardType.gas, hhsrs_category=None,
                     severity=Severity.emergency, is_emergency=True, summary="Potential gas hazard")
    result = compute_deadlines(emergency, friday)
    assert result.investigate_by == friday + timedelta(hours=24)
    assert result.review_required and not result.verified


def test_phase_boundary_and_missing_classification():
    case = Case(id="x", hazard_type=HazardType.electrical, hhsrs_category="electrical_hazards",
                severity=Severity.significant, is_emergency=False, summary="Electrical hazard")
    before = compute_deadlines(case, datetime(2026, 11, 29, tzinfo=timezone.utc))
    after = compute_deadlines(case, datetime(2026, 11, 30, tzinfo=timezone.utc))
    assert before.investigate_by is None and before.review_required
    assert after.investigate_by is not None and after.policy_phase == "phase_2"
    unknown = case.model_copy(update={"hhsrs_category": None})
    assert compute_deadlines(unknown, datetime(2026, 11, 30, tzinfo=timezone.utc)).review_required


def test_emergency_replans_and_is_auditable(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    body = client.post("/api/emergency", json={"text": "Strong smell of gas", "property_id": "p-9"}).json()
    assert body["case"]["is_emergency"] is True
    assert body["plan"] and body["approval"]["status"] == "pending"
    types = {event["type"] for event in client.get("/api/events").json()}
    assert {"emergency.created", "plan.updated", "approval.requested"} <= types


def test_sse_replay_is_private_and_reconnectable(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    secret = "resident@example.test API_KEY=super-secret"
    client.post("/api/reports", json={"text": secret, "property_id": "p-private"})
    first = client.get("/api/stream?once=true")
    assert first.status_code == 200 and "event: case.created" in first.text
    assert secret not in first.text and "super-secret" not in first.text
    concurrent_subscriber = client.get("/api/stream?once=true")
    assert concurrent_subscriber.text == first.text
    last_id = first.text.split("id: ")[-1].splitlines()[0]
    second = client.get("/api/stream?once=true", headers={"Last-Event-ID": last_id})
    assert second.text == ""


def test_python_agent_limits_and_records_failures():
    calls = []
    limited = PythonToolAgent(lambda name, args: calls.append(name), max_iterations=1)
    result = limited.run("case-1")
    assert calls == ["compute_deadlines"]
    assert result[-1]["summary"] == "Agent iteration limit reached"

    failed = PythonToolAgent(lambda name, args: (_ for _ in ()).throw(RuntimeError("sensitive")))
    failure_result = failed.run("case-1")
    assert failure_result[0]["success"] is False
    assert "sensitive" not in failure_result[0]["summary"]


def test_agent_tool_validation_and_failure_audit(tmp_path):
    client = TestClient(create_app(make_service(tmp_path)))
    report = client.post("/api/reports", json={"text": "Mould patch"}).json()
    case_id = report["case"]["id"]
    assert client.post("/api/agent/tools/get_case", json={"case_id": case_id}).status_code == 200
    assert client.post("/api/agent/tools/not_permitted", json={"case_id": case_id}).status_code == 404
    assert client.post("/api/agent/tools/get_case", json={"case_id": "missing"}).status_code == 404
    failures = [item for item in client.get("/api/events").json() if item["type"] == "agent.tool_failed"]
    assert len(failures) >= 2
