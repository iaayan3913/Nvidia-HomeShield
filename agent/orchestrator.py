"""Common bounded agent adapters. Business rules remain in backend.service."""

from __future__ import annotations

import json
from dataclasses import dataclass
from time import monotonic
from typing import Callable, Protocol

import httpx

from agent.tools import TOOL_NAMES, TOOLS
from backend.config import (
    AGENT_MAX_ITERATIONS, AGENT_RUNTIME, COMPONENT_TIMEOUT_SECONDS, NEMOCLAW_URL, USE_MOCKS,
)
from backend.llm_client import AgentLLMClient, LLMError


class AgentBackend(Protocol):
    def run(self, case_id: str) -> list[dict]: ...


@dataclass
class PythonToolAgent:
    """Deterministic fallback that invokes only validated application tools."""

    executor: Callable[[str, dict], object]
    max_iterations: int = AGENT_MAX_ITERATIONS
    timeout_seconds: float = COMPONENT_TIMEOUT_SECONDS
    client: AgentLLMClient | None = None
    use_model: bool = AGENT_RUNTIME == "python" and not USE_MOCKS

    def _deterministic_actions(self, case_id: str) -> list[tuple[str, dict]]:
        return [("compute_deadlines", {"case_id": case_id}),
                ("schedule_job", {"case_id": case_id}),
                ("request_approval", {"case_id": case_id, "action": "commit_plan"})]

    def _actions(self, case_id: str) -> list[tuple[str, dict]]:
        deterministic = self._deterministic_actions(case_id)
        if not self.use_model:
            return deterministic
        client = self.client or AgentLLMClient()
        reply = client.complete([
            {"role": "system", "content": (
                "Select safe HomeShield backend tools. Return JSON only as "
                "{\"actions\":[{\"name\":\"tool_name\",\"arguments\":{...}}]}. "
                "Do not include private reasoning. Consequential actions must request approval.")},
            {"role": "user", "content": f"Coordinate the next safe actions for case ID {case_id}."},
        ], temperature=0, timeout=self.timeout_seconds)
        raw = reply["content"]
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end < start:
            raise LLMError("Agent model did not return a JSON object")
        try:
            value = json.loads(raw[start:end + 1])
        except json.JSONDecodeError as exc:
            raise LLMError("Agent model returned invalid JSON") from exc
        actions: list[tuple[str, dict]] = []
        for item in value.get("actions", []) if isinstance(value, dict) else []:
            if not isinstance(item, dict) or item.get("name") not in TOOL_NAMES:
                continue
            arguments = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
            arguments["case_id"] = case_id
            if item["name"] == "request_approval" and not arguments.get("action"):
                arguments["action"] = "commit_plan"
            actions.append((item["name"], arguments))
        if not actions:
            raise LLMError("Agent model returned no permitted actions")
        critical = [name for name, _ in actions if name in {
            "compute_deadlines", "schedule_job", "request_approval"
        }]
        if critical != ["compute_deadlines", "schedule_job", "request_approval"]:
            raise LLMError("Agent model returned an incomplete or unsafe tool sequence")
        return actions[:self.max_iterations]

    def run(self, case_id: str) -> list[dict]:
        started = monotonic()
        try:
            actions = self._actions(case_id)
        except LLMError as exc:
            actions = self._deterministic_actions(case_id)
            results: list[dict] = [{
                "tool": "agent_reasoning", "success": False,
                "summary": f"Agent reasoning model unavailable ({type(exc).__name__}); deterministic fallback used"
            }]
        else:
            results = []
        for iteration, (name, arguments) in enumerate(actions):
            if iteration >= self.max_iterations:
                results.append({"tool": name, "success": False, "summary": "Agent iteration limit reached"})
                break
            if monotonic() - started > self.timeout_seconds:
                results.append({"tool": name, "success": False, "summary": "Agent time limit reached"})
                break
            if name not in TOOL_NAMES:
                results.append({"tool": name, "success": False, "summary": "Tool is not permitted"})
                continue
            try:
                self.executor(name, arguments)
                results.append({"tool": name, "success": True, "summary": "Tool completed"})
            except Exception as exc:
                results.append({"tool": name, "success": False,
                                "summary": f"Tool failed ({type(exc).__name__})"})
                if name in {"compute_deadlines", "schedule_job"}:
                    # Never request approval when the prerequisite compliance
                    # or scheduling action did not complete successfully.
                    break
        return results


@dataclass
class NemoClawAgent:
    """HTTP integration seam; Person 1 supplies the runtime URL and tool registration."""

    base_url: str = NEMOCLAW_URL
    timeout_seconds: float = COMPONENT_TIMEOUT_SECONDS
    executor: Callable[[str, dict], object] | None = None
    max_iterations: int = AGENT_MAX_ITERATIONS

    def run(self, case_id: str) -> list[dict]:
        if not self.base_url:
            raise RuntimeError("NEMOCLAW_URL is not configured")
        response = httpx.post(
            f"{self.base_url.rstrip('/')}/runs",
            json={"input": {"case_id": case_id}, "tools": TOOLS,
                  "max_iterations": AGENT_MAX_ITERATIONS},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        value = response.json()
        raw_actions = value.get("actions", []) if isinstance(value, dict) else []
        actions = []
        for item in raw_actions[:self.max_iterations] if isinstance(raw_actions, list) else []:
            if not isinstance(item, dict) or item.get("name") not in TOOL_NAMES:
                continue
            arguments = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
            arguments["case_id"] = case_id
            actions.append({"name": item["name"], "arguments": arguments})
        if self.executor is None:
            return raw_actions[:self.max_iterations] if isinstance(raw_actions, list) else []
        results = []
        for item in actions:
            try:
                self.executor(item["name"], item["arguments"])
                results.append({"tool": item["name"], "success": True, "summary": "Tool completed"})
            except Exception as exc:
                results.append({"tool": item["name"], "success": False,
                                "summary": f"Tool failed ({type(exc).__name__})"})
        return results


def build_agent(executor: Callable[[str, dict], object], *, runtime: str | None = None,
                use_mocks: bool | None = None) -> AgentBackend:
    selected = (runtime or AGENT_RUNTIME).lower()
    _ = USE_MOCKS if use_mocks is None else use_mocks  # retained for call-site compatibility
    if selected == "nemoclaw":
        return NemoClawAgent(executor=executor)
    if selected not in {"mock", "python"}:
        raise ValueError(f"unknown agent runtime: {selected}")
    return PythonToolAgent(executor=executor, use_model=selected == "python")
