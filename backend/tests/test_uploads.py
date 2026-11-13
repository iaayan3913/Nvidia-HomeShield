from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.schemas import Case, Evidence, HazardType, Severity
from backend.service import HomeShieldService
from backend.uploads import UploadStore
import intake.agent as intake_agent
import intake.real as real_intake
from scheduler.mock import MockScheduler
from store.sqlite import Store


JPEG = b"\xff\xd8\xff\xe0" + b"photo-data"
PNG = b"\x89PNG\r\n\x1a\n" + b"photo-data"
WAV = b"RIFF" + (20).to_bytes(4, "little") + b"WAVEfmt " + b"audio-data"


def client_for(tmp_path, *, intake=None, adapter="mock", audio_enabled=False,
               max_photo=1024, max_audio=1024):
    uploads = UploadStore(tmp_path / "uploads", max_photo_bytes=max_photo, max_audio_bytes=max_audio)
    service = HomeShieldService(Store(str(tmp_path / "cases.sqlite3")), MockScheduler(), intake=intake,
                                intake_adapter=adapter, upload_store=uploads,
                                intake_audio_enabled=audio_enabled)
    return TestClient(create_app(service)), service, uploads


def test_json_text_only_report_remains_compatible(tmp_path):
    client, service, _ = client_for(tmp_path)
    response = client.post("/api/reports", json={"text": "Water leak", "property_id": "p-json"})
    assert response.status_code == 201
    case = response.json()["case"]
    assert case["property_id"] == "p-json" and case["evidence"] == []
    assert service.store.get_case(case["id"]) is not None


def test_multipart_photo_is_private_persisted_evidence(tmp_path):
    client, service, uploads = client_for(tmp_path)
    response = client.post("/api/reports", data={"text": "Mould on wall", "property_id": "p-photo"},
                           files={"photo": ("wall.jpg", JPEG, "image/jpeg")})
    assert response.status_code == 201
    body = response.json()
    evidence = body["case"]["evidence"][0]
    assert evidence["kind"] == "photo" and evidence["uri"].startswith("upload://")
    assert "image/jpeg" in evidence["description"] and "not analysed" in evidence["description"]
    stored = uploads.resolve(evidence["uri"], "photo")
    assert stored.path.parent == (tmp_path / "uploads").resolve()
    assert stored.path.name != "wall.jpg" and stored.path.read_bytes() == JPEG
    persisted = service.store.get_case(body["case"]["id"])
    assert persisted and persisted.evidence[0].uri == evidence["uri"]


def test_multipart_audio_is_stored_without_analysis_claim(tmp_path):
    client, _, uploads = client_for(tmp_path)
    response = client.post("/api/reports", data={"text": "Boiler noise"},
                           files={"audio": ("report.wav", WAV, "audio/wav")})
    assert response.status_code == 201
    body = response.json()
    evidence = body["case"]["evidence"][0]
    assert evidence["kind"] == "audio"
    assert "not analysed" in evidence["description"]
    assert body["warnings"] and uploads.resolve(evidence["uri"], "audio").path.is_file()


def test_multipart_photo_and_audio_continue_approval_scheduling_and_sse(tmp_path):
    client, _, _ = client_for(tmp_path)
    response = client.post("/api/reports", data={"text": "Mould and dripping sound"}, files={
        "photo": ("room.png", PNG, "image/png"),
        "audio": ("report.wav", WAV, "audio/x-wav"),
    })
    assert response.status_code == 201
    body = response.json()
    assert {item["kind"] for item in body["case"]["evidence"]} == {"photo", "audio"}
    assert body["plan"]["solver"] == "mock" and body["approval"]["status"] == "pending"
    stream = client.get("/api/stream?once=true").text
    assert "event: case.created" in stream and "event: approval.requested" in stream


def test_invalid_mismatched_and_oversized_uploads_are_rejected(tmp_path):
    client, _, _ = client_for(tmp_path, max_photo=32)
    invalid = client.post("/api/reports", data={"text": "Issue"},
                          files={"photo": ("bad.jpg", b"not-an-image", "image/jpeg")})
    assert invalid.status_code == 422
    mismatched = client.post("/api/reports", data={"text": "Issue"},
                             files={"photo": ("bad.jpg", JPEG, "image/png")})
    assert mismatched.status_code == 422
    oversized = client.post("/api/reports", data={"text": "Issue"},
                            files={"photo": ("large.jpg", JPEG + b"x" * 50, "image/jpeg")})
    assert oversized.status_code == 413


def test_path_traversal_and_missing_upload_references_are_rejected(tmp_path):
    client, _, _ = client_for(tmp_path)
    traversal = client.post("/api/reports", data={"text": "Issue"},
                            files={"photo": ("../../secret.jpg", JPEG, "image/jpeg")})
    assert traversal.status_code == 422
    bad_reference = client.post("/api/reports", json={"text": "Issue", "photo_uri": "upload://../secret.jpg"})
    assert bad_reference.status_code == 422
    missing = client.post("/api/reports", json={
        "text": "Issue", "photo_uri": f"upload://{'0' * 32}.jpg"})
    assert missing.status_code == 422
    external = client.post("/api/reports", json={"text": "Issue", "photo_uri": "https://example.test/a.jpg"})
    assert external.status_code == 422


def test_real_adapter_receives_resolved_photo_and_skips_unconfirmed_audio(tmp_path):
    calls = []

    def fake_real(text, photo_uri, audio_uri, property_id):
        calls.append((photo_uri, audio_uri))
        assert Path(photo_uri).is_file()
        return Case(id="case-real-media", hazard_type=HazardType.damp_mould,
                    hhsrs_category=None, severity=Severity.significant, is_emergency=False,
                    summary="Validated media report", property_id=property_id,
                    evidence=[Evidence(kind="photo", uri=photo_uri)])

    client, service, _ = client_for(tmp_path, intake=fake_real, adapter="real", audio_enabled=False)
    response = client.post("/api/reports", data={"text": "Mould report", "property_id": "p-real"}, files={
        "photo": ("room.jpg", JPEG, "image/jpeg"),
        "audio": ("voice.wav", WAV, "audio/wav"),
    })
    assert response.status_code == 201
    assert calls[0][1] is None
    evidence = {item["kind"]: item for item in response.json()["case"]["evidence"]}
    assert evidence["photo"]["uri"].startswith("upload://")
    assert evidence["audio"]["uri"].startswith("upload://")
    assert "not analysed" in evidence["audio"]["description"]
    assert service.store.get_case("case-real-media") is not None
    types = {event.type for _, event in service.store.list_events()}
    assert "intake.media_unavailable" in types


def test_real_audio_can_be_explicitly_enabled_and_failure_is_not_mocked(tmp_path):
    calls = []

    def fake_real(text, photo_uri, audio_uri, property_id):
        calls.append(audio_uri)
        if text == "fail":
            raise RuntimeError("endpoint unavailable")
        assert Path(audio_uri).is_file()
        return Case(id="case-real-audio", hazard_type=HazardType.other, severity=Severity.moderate,
                    is_emergency=False, summary="Audio submitted")

    client, _, _ = client_for(tmp_path, intake=fake_real, adapter="real", audio_enabled=True)
    success = client.post("/api/reports", data={"text": "noise"},
                          files={"audio": ("voice.wav", WAV, "audio/wav")})
    assert success.status_code == 201 and calls[0]

    failed = client.post("/api/reports", data={"text": "fail"},
                         files={"audio": ("voice.wav", WAV, "audio/wav")})
    assert failed.status_code == 422
    assert "real intake adapter" in failed.json()["detail"]


def test_person2_real_adapter_receives_uploaded_photo(monkeypatch, tmp_path):
    observed = {}

    def complete(self, messages, **kwargs):
        observed["parts"] = messages[1]["content"]
        return {"content": '{"hazard_type":"damp_mould","hhsrs_category":null,'
                           '"severity":"significant","is_emergency":false,"room":"bedroom",'
                           '"vulnerable_occupants":[],"summary":"Mould in bedroom"}',
                "reasoning": None}

    monkeypatch.setattr(intake_agent, "INTAKE_ADAPTER", "real")
    monkeypatch.setattr(real_intake.LLMClient, "complete", complete)
    client, service, _ = client_for(tmp_path, intake=intake_agent.analyse_report, adapter="real")
    response = client.post("/api/reports", data={"text": "Mould in bedroom"},
                           files={"photo": ("room.jpg", JPEG, "image/jpeg")})
    assert response.status_code == 201
    assert observed["parts"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    evidence = response.json()["case"]["evidence"][0]
    assert evidence["uri"].startswith("upload://") and "submitted" in evidence["description"]
    persisted = service.store.get_case(response.json()["case"]["id"])
    assert persisted and persisted.evidence[0].uri == evidence["uri"]
