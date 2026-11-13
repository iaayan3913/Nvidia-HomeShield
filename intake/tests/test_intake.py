import pytest
from backend.llm_client import LLMError
from backend.schemas import HazardType, Severity
import intake.agent as agent

FIXTURES = [
    ("Black mould spreading on the wall in my child's bedroom", HazardType.damp_mould),
    ("Water is leaking through the kitchen ceiling", HazardType.leak),
    ("The socket in the hallway sparks when I plug anything in", HazardType.electrical),
]

@pytest.mark.parametrize("text,hazard", FIXTURES)
def test_mock_fixtures_parse(monkeypatch, text, hazard):
    monkeypatch.setattr(agent, "USE_MOCKS", True)
    case = agent.analyse_report(text, photo_uri="upload://x.jpg", audio_uri="upload://x.wav", property_id="p-001")
    assert case.hazard_type == hazard and case.property_id == "p-001"
    assert [e.kind for e in case.evidence] == ["photo", "audio"]

def fake_model(monkeypatch, content=None, error=None):
    def complete(self, messages, **kwargs):
        if error: raise error
        return {"content": content, "reasoning": None}
    monkeypatch.setattr(agent, "USE_MOCKS", False)
    monkeypatch.setattr(agent.LLMClient, "complete", complete)

def test_model_json_validated_and_missing_values_null(monkeypatch):
    fake_model(monkeypatch, '```json\n{"hazard_type":"electrical","severity":"emergency","room":null,'
                            '"vulnerable_occupants":["child"],"summary":"Exposed live wiring"}\n```')
    case = agent.analyse_report("wires hanging out of the wall")
    assert case.hazard_type == HazardType.electrical and case.severity == Severity.emergency
    assert case.is_emergency and case.room is None and case.hhsrs_category is None
    assert case.vulnerable_occupants == ["child"] and case.summary == "Exposed live wiring"

@pytest.mark.parametrize("raw,msg", [("sorry, cannot help", "did not return a JSON object"),
                                     ('{"hazard_type": "mould",}', "invalid JSON"),
                                     ('{"hazard_type": "mould"}', "hazard_type")])
def test_invalid_model_json_is_explicit_error(raw, msg):
    with pytest.raises(agent.IntakeError, match=msg):
        agent.parse_extraction(raw)

@pytest.mark.parametrize("error,content", [(LLMError("connection refused"), None), (None, "not json")])
def test_model_failure_falls_back_to_text_only(monkeypatch, error, content):
    fake_model(monkeypatch, content, error)
    case = agent.analyse_report("Water leaking under the sink")
    assert case.hazard_type == HazardType.leak

def test_photo_and_audio_are_sent_to_model(tmp_path):
    photo, audio = tmp_path / "p.jpg", tmp_path / "a.wav"
    photo.write_bytes(b"jpg"); audio.write_bytes(b"wav")
    parts = agent._build_messages("mould", f"upload://{photo}", str(audio))[1]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert parts[2]["input_audio"]["format"] == "wav"
