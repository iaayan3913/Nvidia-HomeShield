import pytest
from backend.llm_client import LLMError
from backend.schemas import HazardType, Severity
import intake.agent as agent
import intake.real as real

FIXTURES = [
    ("Black mould spreading on the wall in my child's bedroom", HazardType.damp_mould),
    ("Water is leaking through the kitchen ceiling", HazardType.leak),
    ("The socket in the hallway sparks when I plug anything in", HazardType.electrical),
]

@pytest.mark.parametrize("text,hazard", FIXTURES)
def test_mock_fixtures_parse(monkeypatch, text, hazard):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    case = agent.analyse_report(text, photo_uri="upload://x.jpg", audio_uri="upload://x.wav", property_id="p-001")
    assert case.hazard_type == hazard and case.property_id == "p-001"
    assert [e.kind for e in case.evidence] == ["photo", "audio"]

def fake_model(monkeypatch, content=None, error=None):
    def complete(self, messages, **kwargs):
        if error: raise error
        return {"content": content, "reasoning": None}
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "real")
    monkeypatch.setattr(real.LLMClient, "complete", complete)

def test_real_model_json_validated_and_missing_values_null(monkeypatch):
    fake_model(monkeypatch, '```json\n{"hazard_type":"electrical","severity":"emergency","room":null,'
                            '"vulnerable_occupants":["child"],"summary":"Exposed live wiring","extra":1}\n```')
    case = agent.analyse_report("wires hanging out of the wall", audio_uri="upload://a.wav")
    assert case.hazard_type == HazardType.electrical and case.severity == Severity.emergency
    assert case.is_emergency and case.room is None and case.hhsrs_category is None
    assert case.vulnerable_occupants == ["child"] and case.summary == "Exposed live wiring"
    assert [e.kind for e in case.evidence] == ["audio"]

@pytest.mark.parametrize("raw,msg", [("sorry, cannot help", "did not return a JSON object"),
                                     ('{"hazard_type": "mould",}', "invalid JSON"),
                                     ('{"hazard_type": "mould", "severity": "moderate"}', "hazard_type"),
                                     ('{"hazard_type": "leak"}', "severity")])
def test_invalid_model_json_is_explicit_error(raw, msg):
    with pytest.raises(real.IntakeError, match=msg):
        real.parse_case(raw, "report text")

def test_model_request_failure_is_explicit_error(monkeypatch):
    fake_model(monkeypatch, error=LLMError("connection refused"))
    with pytest.raises(real.IntakeError, match="request failed: connection refused"):
        agent.analyse_report("Water leaking under the sink")

def test_photo_and_audio_are_sent_to_model(monkeypatch, tmp_path):
    monkeypatch.setattr(real, "UPLOAD_DIR", tmp_path)
    (tmp_path / "p.jpg").write_bytes(b"jpg"); (tmp_path / "a.mp3").write_bytes(b"mp3")
    parts = real._build_messages("mould", "upload://p.jpg", "upload://a.mp3")[1]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert parts[2]["input_audio"]["format"] == "mp3"

def test_media_outside_uploads_is_never_sent(monkeypatch, tmp_path):
    uploads = tmp_path / "uploads"; uploads.mkdir()
    secret = tmp_path / ".env"; secret.write_text("LLM_API_KEY=secret")
    monkeypatch.setattr(real, "UPLOAD_DIR", uploads)
    for uri in ("upload://../.env", f"upload://{secret}", str(secret), "https://example.com/x.jpg"):
        assert len(real._build_messages("mould", uri, uri)[1]["content"]) == 1

def test_long_report_and_inline_thinking(monkeypatch):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    assert len(agent.analyse_report("mould " * 900).summary) == 1000
    case = real.parse_case('<think>maybe {"hazard_type": "gas"}</think>{"hazard_type":"leak","severity":"moderate"}',
                           "x" * 5000)
    assert case.hazard_type == HazardType.leak and len(case.summary) == 1000
