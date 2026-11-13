"""NemoClaw/OpenAI-compatible tool declarations; registration is runtime-owned."""


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required,
                           "additionalProperties": False}}}


TOOLS = [
    _tool("create_case", "Persist a validated case", {"case": {"type": "object"}}, ["case"]),
    _tool("get_case", "Retrieve a housing case", {"case_id": {"type": "string"}}, ["case_id"]),
    _tool("get_repair_history", "Retrieve safe case status history", {"case_id": {"type": "string"}}, ["case_id"]),
    _tool("compute_deadlines", "Calculate configured compliance deadlines", {"case_id": {"type": "string"}}, ["case_id"]),
    _tool("schedule_job", "Request a schedule proposal", {"case_id": {"type": "string"}}, ["case_id"]),
    _tool("request_approval", "Request human approval", {"case_id": {"type": "string"}, "action": {"type": "string"}}, ["case_id", "action"]),
    _tool("notify_resident", "Queue a resident notification for approval", {"case_id": {"type": "string"}, "message": {"type": "string", "maxLength": 500}}, ["case_id", "message"]),
    _tool("escalate", "Queue an operational escalation for approval", {"case_id": {"type": "string"}, "reason": {"type": "string", "maxLength": 500}}, ["case_id", "reason"]),
]

TOOL_NAMES = {item["function"]["name"] for item in TOOLS}
