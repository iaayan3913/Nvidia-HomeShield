"""Round 2 platform endpoints: properties, public case view, jobs/progress, dev reset, stream filters."""
import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.schemas import Case, HazardType, Severity
from backend.service import HomeShieldService
from scheduler.mock import MockScheduler
from store.sqlite import Store

CONTACT = {"name": "Resident Example", "phone": "07123 456789", "preferred": "text", "access_notes": "Side gate code 1234"}


def fixed_time_intake(text, photo_uri, audio_uri, property_id):
    # Created inside the fixture shifts so scheduling does not depend on the real time of day.
    return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=HazardType.leak, severity=Severity.moderate, is_emergency=False,
                summary=text, property_id=property_id, created_at=datetime(2026, 11, 13, 10, 0, tzinfo=timezone.utc))


def make_client(tmp_path, **kwargs):
    service = HomeShieldService(Store(str(tmp_path / "platform.sqlite3")), MockScheduler(), scheduler_seed_jobs=False,
                                agent_runtime="mock", intake=fixed_time_intake, intake_adapter="mock")
    return TestClient(create_app(service, **kwargs)), service


def submit(client, **extra):
    response = client.post("/api/reports", json={"text": "Water leak under the kitchen sink", "property_id": "p-001", **extra})
    assert response.status_code == 201, response.text
    return response.json()


def approve_case(client, body):
    approval = body["approval"]
    assert approval["action"] == "commit_plan"
    assert client.post(f"/api/approvals/{approval['id']}/approve", json={"decided_by": "officer-1"}).status_code == 200


def test_health_alias_reports_dev_reset_flag(tmp_path):
    client, _ = make_client(tmp_path)
    assert client.get("/api/health").json()["dev_reset"] is False
    assert client.post("/api/dev/reset").status_code == 404
    enabled, _ = make_client(tmp_path, allow_dev_reset=True)
    assert enabled.get("/health").json()["dev_reset"] is True


def test_property_search_by_district_area_and_id(tmp_path):
    client, _ = make_client(tmp_path)
    everything = client.get("/api/properties", params={"limit": 500}).json()
    assert len(everything) > 50 and everything[0]["synthetic"] is True
    sample = everything[0]
    by_district = client.get("/api/properties", params={"q": f"{sample['district']} 1AB"}).json()
    assert by_district and all(item["district"] == sample["district"] for item in by_district)
    assert client.get("/api/properties", params={"q": sample["id"]}).json()[0]["id"] == sample["id"]
    assert client.get("/api/properties", params={"q": "zzzz-no-match"}).json() == []


def test_contact_details_are_private(tmp_path):
    client, service = make_client(tmp_path)
    body = submit(client, contact=CONTACT, address_line="Flat 2, 10 Example Road", postcode="S4 7AA")
    case_id = body["case"]["id"]
    assert service.records.get_contact(case_id)["contact"]["phone"] == CONTACT["phone"]
    leaks = json.dumps(client.get("/api/events").json()) + json.dumps(client.get(f"/api/cases/{case_id}").json())
    leaks += client.get("/api/stream", params={"once": True}).text
    for secret in ("07123 456789", "Resident Example", "Example Road", "1234"):
        assert secret not in leaks


def test_multipart_report_accepts_contact_fields(tmp_path):
    client, service = make_client(tmp_path)
    fields = {"text": "Mould in bedroom", "property_id": "p-001", "contact_name": "A Resident",
              "contact_phone": "0700", "contact_preferred": "phone", "postcode": "S4 7AA"}
    response = client.post("/api/reports", files={key: (None, value) for key, value in fields.items()})
    assert response.status_code == 201
    details = service.records.get_contact(response.json()["case"]["id"])
    assert details["contact"] == {"name": "A Resident", "phone": "0700", "preferred": "phone"}
    assert details["address"]["postcode"] == "S4 7AA"


def test_public_case_hides_internal_fields(tmp_path):
    client, _ = make_client(tmp_path)
    case_id = submit(client)["case"]["id"]
    public = client.get(f"/api/cases/{case_id}/public").json()
    assert public["id"] == case_id and "status" in public
    assert "evidence" not in public and "vulnerable_occupants" not in public and "hhsrs_category" not in public
    assert client.get("/api/cases/missing/public").status_code == 404


def test_job_progress_flow_updates_case_and_emits_safe_event(tmp_path):
    client, _ = make_client(tmp_path)
    body = submit(client, contact=CONTACT)
    case_id = body["case"]["id"]
    job_id = f"job-{case_id}"
    job = next(item for item in client.get("/api/jobs").json() if item["id"] == job_id)
    assert job["status"] == "unassigned" and job["access_notes"] == CONTACT["access_notes"]
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "travelling"}).status_code == 409

    approve_case(client, body)
    assert next(item for item in client.get("/api/jobs").json() if item["id"] == job_id)["status"] == "assigned"
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "completed", "notes": "x"}).status_code == 409
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "travelling"}).status_code == 200
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "on_site"}).status_code == 200
    assert client.get(f"/api/cases/{case_id}").json()["status"] == "in_progress"
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "completed"}).status_code == 422
    done = client.post(f"/api/jobs/{job_id}/progress",
                       json={"status": "completed", "notes": "Replaced trap seal", "evidence_count": 2})
    assert done.status_code == 200 and done.json()["evidence_count"] == 2
    assert client.get(f"/api/cases/{case_id}").json()["status"] == "resolved"
    assert client.post(f"/api/jobs/{job_id}/progress", json={"status": "on_site"}).status_code == 409
    progress = [e for e in client.get("/api/events").json() if e["type"] == "job.progress"]
    assert [e["payload"]["status"] for e in progress] == ["travelling", "on_site", "completed"]
    assert "Replaced trap seal" not in json.dumps(progress)
    assert client.post("/api/jobs/nope/progress", json={"status": "travelling"}).status_code == 404


def test_stream_filters_by_case_and_tail(tmp_path):
    client, _ = make_client(tmp_path)
    first = submit(client)["case"]["id"]
    second = submit(client)["case"]["id"]
    filtered = client.get("/api/stream", params={"once": True, "case_id": first}).text
    assert first in filtered and second not in filtered
    assert client.get("/api/stream", params={"once": True, "tail": True}).text == ""
    events = client.get("/api/events").json()
    after = client.get("/api/stream", params={"once": True, "after": events[-2]["sequence"]}).text
    assert after.count("\nevent: ") + after.startswith("event: ") <= 1 and f"id: {events[-1]['sequence']}" in after


def test_dev_reset_clears_data_and_emits_reset(tmp_path):
    client, service = make_client(tmp_path, allow_dev_reset=True)
    submit(client, contact=CONTACT)
    before = service.latest_event_sequence()
    assert client.post("/api/dev/reset").json() == {"status": "reset"}
    assert client.get("/api/cases").json() == [] and client.get("/api/approvals").json() == []
    events = client.get("/api/events").json()
    assert [e["type"] for e in events] == ["system.reset"] and events[0]["sequence"] > before


def test_events_tail_returns_newest(tmp_path):
    client, _ = make_client(tmp_path)
    submit(client)
    every = client.get("/api/events").json()
    newest = client.get("/api/events", params={"tail": 2}).json()
    assert [e["sequence"] for e in newest] == [e["sequence"] for e in every[-2:]]


def test_evening_report_is_scheduled_on_the_demo_clock(tmp_path):
    """A report made after every fixture shift (21:00 wall clock) still gets a window on the scheduler's clock."""
    def evening_intake(text, photo_uri, audio_uri, property_id):
        return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=HazardType.leak, severity=Severity.moderate,
                    is_emergency=False, summary=text, property_id=property_id,
                    created_at=datetime(2026, 11, 13, 21, 0, tzinfo=timezone.utc))
    service = HomeShieldService(Store(str(tmp_path / "evening.sqlite3")), MockScheduler(), scheduler_seed_jobs=False,
                                agent_runtime="mock", intake=evening_intake, intake_adapter="mock")
    service.scheduling.clock.now = lambda: datetime(2026, 11, 13, 11, 0)
    client = TestClient(create_app(service))
    body = submit(client)
    job_id = f"job-{body['case']['id']}"
    assert body["plan"]["unassigned_jobs"] == []
    assert any(stop["job_id"] == job_id for route in body["plan"]["workers"] for stop in route["stops"])
    # The window start is fixed on first planning, so a later clock does not move it.
    first = next(j for j in client.get("/api/jobs").json() if j["id"] == job_id)["earliest"]
    service.scheduling.clock.now = lambda: datetime(2026, 11, 13, 14, 0)
    assert next(j for j in client.get("/api/jobs").json() if j["id"] == job_id)["earliest"] == first
