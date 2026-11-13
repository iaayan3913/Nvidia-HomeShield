from types import SimpleNamespace

import pytest

import intake.real as real_intake
from agent.orchestrator import NemoClawAgent, PythonToolAgent, build_agent
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
            return {"content": '{"actions":['
                               '{"name":"compute_deadlines","arguments":{}},'
                               '{"name":"schedule_job","arguments":{}},'
                               '{"name":"request_approval","arguments":{"action":"commit_plan"}}]}',
                    "reasoning": "must not be returned"}

    executed = []
    agent = PythonToolAgent(lambda name, args: executed.append((name, args)),
                            client=FakeLightning(), use_model=True)
    result = agent.run("case-123")
    assert calls and [name for name, _ in executed] == [
        "compute_deadlines", "schedule_job", "request_approval"
    ]
    assert all(item["success"] for item in result)
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
    AgentLLMClient(base_url="http://lightning:11434/v1", api_key="agent", model="lightning",
                   chat_template_control="auto").complete([])
    AgentLLMClient(base_url="https://integrate.api.nvidia.com/v1", api_key="hosted", model="hosted",
                   chat_template_control="auto").complete([])
    assert clients == [("http://omni:8000/v1", "omni"),
                       ("http://lightning:11434/v1", "agent"),
                       ("https://integrate.api.nvidia.com/v1", "hosted")]
    assert [request["model"] for request in requests] == ["omni", "lightning", "hosted"]
    assert "extra_body" not in requests[0]
    assert requests[1]["extra_body"] == {
        "chat_template_kwargs": {"enable_thinking": False}
    }
    assert "extra_body" not in requests[2]


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


def test_runtime_factory_selects_distinct_execution_paths():
    executor = lambda *_: None
    mock = build_agent(executor, runtime="mock")
    python = build_agent(executor, runtime="python")
    nemoclaw = build_agent(executor, runtime="nemoclaw")
    assert isinstance(mock, PythonToolAgent) and mock.use_model is False
    assert isinstance(python, PythonToolAgent) and python.use_model is True
    assert isinstance(nemoclaw, NemoClawAgent) and nemoclaw.executor is executor


def test_nemoclaw_actions_execute_only_through_validated_executor(monkeypatch):
    class Response:
        def raise_for_status(self): return None
        def json(self):
            return {"actions": [{"name": "get_case", "arguments": {"case_id": "wrong"}},
                                {"name": "not_permitted", "arguments": {}}]}
    monkeypatch.setattr("agent.orchestrator.httpx.post", lambda *args, **kwargs: Response())
    executed = []
    result = NemoClawAgent(base_url="http://nemoclaw", executor=lambda name, args: executed.append((name, args))).run("case-safe")
    assert executed == [("get_case", {"case_id": "case-safe"})]
    assert result == [{"tool": "get_case", "success": True, "summary": "Tool completed"}]


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

    executed.clear()
    result = PythonToolAgent(lambda name, args: executed.append(name),
                             client=Unavailable(), use_model=True).run("case-real")
    assert executed == ["compute_deadlines", "schedule_job", "request_approval"]
    assert result[0] == {"tool": "agent_reasoning", "success": False,
                         "summary": "Agent reasoning model unavailable (LLMError); deterministic fallback used"}
    assert all(item["success"] for item in result[1:])


@pytest.mark.parametrize("content", ["", '{"actions":[]}'])
def test_empty_lightning_output_uses_ordered_fallback(content):
    class EmptyLightning:
        def complete(self, messages, **kwargs):
            return {"content": content, "reasoning": None}

    executed = []
    result = PythonToolAgent(lambda name, args: executed.append(name),
                             client=EmptyLightning(), use_model=True).run("case-empty")
    assert executed == ["compute_deadlines", "schedule_job", "request_approval"]
    assert "deterministic fallback used" in result[0]["summary"]


def test_timeout_and_unsafe_tool_order_use_fallback():
    class TimeoutLightning:
        def complete(self, messages, **kwargs):
            raise LLMError("timed out")

    timed = []
    PythonToolAgent(lambda name, args: timed.append(name), client=TimeoutLightning(),
                    use_model=True).run("case-timeout")
    assert timed == ["compute_deadlines", "schedule_job", "request_approval"]

    class UnsafeLightning:
        def complete(self, messages, **kwargs):
            return {"content": '{"actions":['
                               '{"name":"request_approval","arguments":{"action":"commit_plan"}},'
                               '{"name":"schedule_job","arguments":{}},'
                               '{"name":"compute_deadlines","arguments":{}}]}'}

    ordered = []
    result = PythonToolAgent(lambda name, args: ordered.append(name), client=UnsafeLightning(),
                             use_model=True).run("case-unsafe")
    assert ordered == ["compute_deadlines", "schedule_job", "request_approval"]
    assert "deterministic fallback used" in result[0]["summary"]


def test_failed_scheduling_never_requests_approval():
    executed = []

    def executor(name, arguments):
        executed.append(name)
        if name == "schedule_job":
            raise RuntimeError("scheduler unavailable")

    result = PythonToolAgent(executor, use_model=False).run("case-failed")
    assert executed == ["compute_deadlines", "schedule_job"]
    assert result[-1]["tool"] == "schedule_job" and result[-1]["success"] is False


def test_missing_nemoclaw_configuration_is_explicit():
    with pytest.raises(RuntimeError, match="NEMOCLAW_URL is not configured"):
        NemoClawAgent(base_url="").run("case-1")


def test_default_intake_and_agent_endpoints_are_separate():
    assert LLM_BASE_URL != AGENT_BASE_URL
