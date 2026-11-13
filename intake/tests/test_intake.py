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

def test_photo_and_audio_are_sent_to_model(tmp_path):
    photo, audio = tmp_path / "p.jpg", tmp_path / "a.mp3"
    photo.write_bytes(b"jpg"); audio.write_bytes(b"mp3")
    parts = real._build_messages("mould", str(photo), str(audio))[1]["content"]
    assert parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert parts[2]["input_audio"]["format"] == "mp3"
    assert len(real._build_messages("mould", "upload://missing.jpg", None)[1]["content"]) == 1

def test_long_report_and_inline_thinking(monkeypatch):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    assert len(agent.analyse_report("mould " * 900).summary) == 1000
    case = real.parse_case('<think>maybe {"hazard_type": "gas"}</think>{"hazard_type":"leak","severity":"moderate"}',
                           "x" * 5000)
    assert case.hazard_type == HazardType.leak and len(case.summary) == 1000


@pytest.mark.parametrize("text,hazard,severity,room,vulnerable", [
    ("Black mould spots on my bedroom wall and my 4-year-old sleeps in there.", "damp_mould", "significant", "bedroom", ["child"]),
    ("The kitchen ceiling is peeling since the flat upstairs had a leak.", "leak", "moderate", "kitchen", []),
    ("The socket in my living room burnt out, bare wires showing, children in the house.", "electrical", "emergency", "living room", ["child"]),
])
def test_mock_matches_demo_reports(monkeypatch, text, hazard, severity, room, vulnerable):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    case = agent.analyse_report(text)
    assert (case.hazard_type.value, case.severity.value, case.room, case.vulnerable_occupants) == (hazard, severity, room, vulnerable)
    assert case.is_emergency == (severity == "emergency")

def test_model_output_is_normalised_and_emergency_is_consistent():
    case = real.parse_case('{"hazard_type":" Leak ","severity":"Moderate","is_emergency":true,'
                           '"vulnerable_occupants":"elderly"}', "report")
    assert case.hazard_type == HazardType.leak and case.vulnerable_occupants == ["elderly"]
    assert case.severity == Severity.emergency and case.is_emergency
    assert not real.parse_case('{"hazard_type":"leak","severity":"moderate","is_emergency":false}', "r").is_emergency


def test_damp_mould_with_vulnerable_occupants_is_at_least_significant():
    raw = '{"hazard_type":"damp_mould","severity":"moderate","vulnerable_occupants":%s}'
    assert real.parse_case(raw % '["child"]', "r").severity == Severity.significant
    assert real.parse_case(raw % '[]', "r").severity == Severity.moderate


def test_model_cannot_confirm_hhsrs_classification():
    # rules treat hhsrs_category as a professional classification, so the AI's guess must be ignored
    case = real.parse_case('{"hazard_type":"electrical","severity":"significant","hhsrs_category":"Electrical hazards"}', "r")
    assert case.hhsrs_category is None


ASTHMA = "Black mould on the wall in my toddler's bedroom. She has asthma and her breathing is getting worse."

def test_mould_with_asthma_is_emergency_in_mock(monkeypatch):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    case = agent.analyse_report(ASTHMA)
    assert case.severity == Severity.emergency and case.is_emergency
    assert case.vulnerable_occupants == ["child", "respiratory_condition"]

def test_mould_with_respiratory_condition_is_emergency_from_model():
    case = real.parse_case('{"hazard_type":"damp_mould","severity":"significant",'
                           '"vulnerable_occupants":["child","respiratory_condition"]}', ASTHMA)
    assert case.severity == Severity.emergency and case.is_emergency


def test_report_text_guardrail_catches_asthma_when_model_omits_vulnerability():
    case = real.parse_case('{"hazard_type":"damp_mould","severity":"moderate",'
                           '"vulnerable_occupants":[],"health_symptoms":false}', ASTHMA)
    assert case.severity == Severity.emergency and case.is_emergency
    assert case.vulnerable_occupants == ["child", "respiratory_condition"]
    assert case.hhsrs_category is None


COUGH = "Black mould on my son's bedroom wall. He's 3 and has been coughing at night for two weeks."

def test_mould_with_symptoms_is_emergency(monkeypatch):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    assert agent.analyse_report(COUGH).is_emergency
    assert real.parse_case('{"hazard_type":"damp_mould","severity":"significant","vulnerable_occupants":["child"],'
                           '"health_symptoms":true}', COUGH).is_emergency
    # child but no symptoms or condition stays significant (guidance's non-emergency contrast)
    assert not real.parse_case('{"hazard_type":"damp_mould","severity":"significant","vulnerable_occupants":["child"],'
                               '"health_symptoms":false}', "r").is_emergency


@pytest.mark.parametrize("text,expected_hazard,expected_severity,emergency", [
    ("Minor small patch of mould in an adult's hallway, no symptoms.", "damp_mould", "moderate", False),
    ("Severe widespread mould throughout the bedroom, no health symptoms reported.", "damp_mould", "significant", False),
    ("Mould across the bedroom wall; I have no information about who sleeps there.", "damp_mould", "significant", False),
    ("There is a strong smell of gas in the kitchen.", "gas", "emergency", True),
    ("Exposed live wiring is sparking beside the socket.", "electrical", "emergency", True),
])
def test_deterministic_safety_guardrails(monkeypatch, text, expected_hazard, expected_severity, emergency):
    monkeypatch.setattr(agent, "INTAKE_ADAPTER", "mock")
    case = agent.analyse_report(text)
    assert case.hazard_type.value == expected_hazard
    assert case.severity.value == expected_severity
    assert case.is_emergency is emergency
    assert case.hhsrs_category is None


@pytest.mark.parametrize("photo,audio", [(None, None), ("upload://p.jpg", None),
                                           (None, "upload://a.wav"),
                                           ("upload://p.jpg", "upload://a.wav")])
def test_media_combinations_preserve_explicit_unknown_hhsrs_review(photo, audio):
    case = real.parse_case('{"hazard_type":"damp_mould","severity":"significant",'
                           '"vulnerable_occupants":[],"summary":"Mould requires inspection"}',
                           "Mould requires inspection", photo, audio)
    assert case.hhsrs_category is None
    expected = [kind for kind, value in (("photo", photo), ("audio", audio)) if value]
    assert [item.kind for item in case.evidence] == expected
