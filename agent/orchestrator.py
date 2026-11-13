"""Common bounded agent adapters. Business rules remain in backend.service."""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Callable, Protocol

import httpx

from agent.tools import TOOL_NAMES, TOOLS
from backend.config import AGENT_MAX_ITERATIONS, COMPONENT_TIMEOUT_SECONDS, NEMOCLAW_URL


class AgentBackend(Protocol):
    def run(self, case_id: str) -> list[dict]: ...


@dataclass
class PythonToolAgent:
    """Deterministic fallback that invokes only validated application tools."""

    executor: Callable[[str, dict], object]
    max_iterations: int = AGENT_MAX_ITERATIONS
    timeout_seconds: float = COMPONENT_TIMEOUT_SECONDS

    def run(self, case_id: str) -> list[dict]:
        started = monotonic()
        actions = [("compute_deadlines", {"case_id": case_id}),
                   ("schedule_job", {"case_id": case_id}),
                   ("request_approval", {"case_id": case_id, "action": "commit_plan"})]
        results: list[dict] = []
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
        return results


@dataclass
class NemoClawAgent:
    """HTTP integration seam; Person 1 supplies the runtime URL and tool registration."""

    base_url: str = NEMOCLAW_URL
    timeout_seconds: float = COMPONENT_TIMEOUT_SECONDS

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
        return value.get("actions", []) if isinstance(value, dict) else []
