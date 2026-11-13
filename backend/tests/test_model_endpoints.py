from types import SimpleNamespace

import pytest

import intake.real as real_intake
from agent.orchestrator import NemoClawAgent, PythonToolAgent
from backend.config import AGENT_BASE_URL, AGENT_MODEL, LLM_BASE_URL, NEMOCLAW_URL
from backend.llm_client import AgentLLMClient, LLMClient, LLMError


def test_intake_uses_omni_endpoint_and_model(monkeypatch):
    observed = {}

    class FakeClient:
        def __init__(self, base_url, api_key, model):
            observed.update(base_url=base_url, api_key=api_key, model=model)

        def complete(self, messages, **kwargs):
            return {"content": '{"hazard_type":"leak","severity":"moderate",'
                               '"is_emergency":false,"room":"kitchen",'
                               '"vulnerable_occupants":[],"summary":"Leak in kitchen"}',
                    "reasoning": None}

    monkeypatch.setattr(real_intake, "LLM_BASE_URL", "http://omni.internal:8000/v1")
    monkeypatch.setattr(real_intake, "LLM_API_KEY", "omni-key")
    monkeypatch.setattr(real_intake, "INTAKE_MODEL", "nano-omni")
    monkeypatch.setattr(real_intake, "LLMClient", FakeClient)
    case = real_intake.analyse_report("Water leak")
    assert case.hazard_type.value == "leak"
    assert observed == {"base_url": "http://omni.internal:8000/v1",
                        "api_key": "omni-key", "model": "nano-omni"}


def test_python_agent_uses_lightning_client_for_tool_selection():
    calls = []

    class FakeLightning:
        base_url = "http://lightning.internal:11434/v1"
        model = "nemotron-lightning"

        def complete(self, messages, **kwargs):
            calls.append((messages, kwargs))
            return {"content": '{"actions":[{"name":"get_case","arguments":{}}]}',
                    "reasoning": "must not be returned"}

    executed = []
    agent = PythonToolAgent(lambda name, args: executed.append((name, args)),
                            client=FakeLightning(), use_model=True)
    result = agent.run("case-123")
    assert calls and executed == [("get_case", {"case_id": "case-123"})]
    assert result == [{"tool": "get_case", "success": True, "summary": "Tool completed"}]
    assert AgentLLMClient().base_url == AGENT_BASE_URL
    assert AgentLLMClient().model == AGENT_MODEL


def test_llm_clients_send_requests_to_their_own_base_urls(monkeypatch):
    clients = []
    requests = []

    class FakeCompletions:
        def create(self, **kwargs):
            requests.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content="READY", reasoning_content=None))])

    class FakeOpenAI:
        def __init__(self, base_url, api_key):
            clients.append((base_url, api_key))
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)
    LLMClient(base_url="http://omni:8000/v1", api_key="omni", model="omni").complete([])
    AgentLLMClient(base_url="http://lightning:11434/v1", api_key="agent", model="lightning").complete([])
    assert clients == [("http://omni:8000/v1", "omni"),
                       ("http://lightning:11434/v1", "agent")]
    assert [request["model"] for request in requests] == ["omni", "lightning"]


def test_nemoclaw_url_remains_independent(monkeypatch):
    observed = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"actions": [{"name": "get_case"}]}

    def fake_post(url, **kwargs):
        observed.update(url=url, kwargs=kwargs)
        return Response()

    monkeypatch.setattr("agent.orchestrator.httpx.post", fake_post)
    actions = NemoClawAgent(base_url="http://nemoclaw.internal:9000").run("case-1")
    assert observed["url"] == "http://nemoclaw.internal:9000/runs"
    assert actions == [{"name": "get_case"}]
    assert NEMOCLAW_URL != AGENT_BASE_URL or not NEMOCLAW_URL


def test_mock_agent_is_offline_and_unavailable_agent_is_clear():
    class MustNotRun:
        def complete(self, messages, **kwargs):
            raise AssertionError("mock mode called a model")

    executed = []
    mock = PythonToolAgent(lambda name, args: executed.append(name), client=MustNotRun(), use_model=False)
    assert all(item["success"] for item in mock.run("case-mock"))
    assert executed == ["compute_deadlines", "schedule_job", "request_approval"]

    class Unavailable:
        def complete(self, messages, **kwargs):
            raise LLMError("endpoint unavailable")

    result = PythonToolAgent(lambda *_: None, client=Unavailable(), use_model=True).run("case-real")
    assert result == [{"tool": "agent_reasoning", "success": False,
                       "summary": "Agent reasoning model unavailable (LLMError)"}]


def test_missing_nemoclaw_configuration_is_explicit():
    with pytest.raises(RuntimeError, match="NEMOCLAW_URL is not configured"):
        NemoClawAgent(base_url="").run("case-1")


def test_default_intake_and_agent_endpoints_are_separate():
    assert LLM_BASE_URL != AGENT_BASE_URL
