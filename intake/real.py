"""Real intake adapter (INTAKE_ADAPTER=real): resident report -> Nano Omni -> validated Case.

Errors are raised, never hidden: the backend reports them and the demo switches to INTAKE_ADAPTER=mock.
"""
import base64, json, mimetypes, re
from pathlib import Path
from uuid import uuid4
from pydantic import ValidationError
from backend.config import COMPONENT_TIMEOUT_SECONDS, INTAKE_MODEL, LLM_API_KEY, LLM_BASE_URL
from backend.llm_client import LLMClient, LLMError
from backend.schemas import Case, Evidence

class IntakeError(RuntimeError): pass

# hhsrs_category is deliberately not taken from the model: agent/rules.py treats any value as a
# competent-person classification and skips human review, so it must stay null until a person confirms it.
MODEL_FIELDS = ("hazard_type", "severity", "room", "vulnerable_occupants")

PROMPT = """You are a social-housing repairs triage assistant. Read the resident's report (and any photo or audio) and extract housing hazards.
Reply with ONE JSON object only, no prose, using exactly these keys:
{"hazard_type": "damp_mould|leak|electrical|gas|fire|other",
 "severity": "routine|moderate|significant|emergency",
 "is_emergency": true or false (immediate risk to health or safety, e.g. gas smell, exposed live wiring, fire, major flooding),
 "room": "room name or null",
 "vulnerable_occupants": only those the report actually mentions, from ["child", "elderly", "disabled", "pregnant", "respiratory_condition"], else [],
 "summary": "one neutral sentence describing the hazard"}
Classify hazard_type by root cause: water coming in from pipes, roof or a neighbouring flat is "leak" even if it has caused damp or stains; use "damp_mould" for condensation and mould growth.
Severity guide: emergency = immediate danger to life or safety; significant = a health risk, e.g. damp or mould where a child, elderly or ill person lives or sleeps, or a leak near electrics; moderate = needs repair but no direct health risk; routine = cosmetic.
Use null for anything the report does not state. Never include names, phone numbers, emails or addresses in any field."""

def _local_file(path: str | None) -> Path | None:
    # Media paths come only from backend.uploads.UploadStore.resolve, which validates location and file type.
    return Path(path) if path and Path(path).is_file() else None

def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()

def _build_messages(text: str, photo_uri: str | None, audio_uri: str | None) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": f"Resident report:\n{text}"}]
    photo = _local_file(photo_uri)
    if photo and (mime := mimetypes.guess_type(photo.name)[0] or "").startswith("image/"):
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{_b64(photo)}"}})
    if audio := _local_file(audio_uri):
        # VERIFY: Nano Omni's accepted audio part/formats; this is the OpenAI input_audio shape (wav, mp3).
        content.append({"type": "input_audio", "input_audio": {"data": _b64(audio), "format": audio.suffix.lstrip(".").lower()}})
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": content}]

def parse_case(raw: str, text: str, photo_uri: str | None = None, audio_uri: str | None = None,
               property_id: str | None = None) -> Case:
    """Validate model output into a Case; errors never echo report content (no personal data in logs)."""
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.S)  # some reasoning models inline their thinking
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end < start:
        raise IntakeError("Intake model did not return a JSON object")
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError as exc:
        raise IntakeError(f"Intake model returned invalid JSON at char {exc.pos}") from exc
    if not isinstance(data, dict):
        raise IntakeError("Intake model did not return a JSON object")
    fields = {k: data[k] for k in MODEL_FIELDS if data.get(k) is not None}  # unknown keys dropped, nulls stay null
    for key in ("hazard_type", "severity"):  # tolerate "Leak" / " moderate "
        if isinstance(fields.get(key), str):
            fields[key] = fields[key].strip().lower()
    if isinstance(fields.get("vulnerable_occupants"), str):
        fields["vulnerable_occupants"] = [fields["vulnerable_occupants"]]
    if data.get("is_emergency") is True:
        fields["severity"] = "emergency"  # err on the side of safety when the model's two signals disagree
    if (fields.get("hazard_type") == "damp_mould" and fields.get("vulnerable_occupants")
            and fields.get("severity") in ("routine", "moderate")):
        fields["severity"] = "significant"  # the model wavers here; damp/mould with vulnerable occupants is a health risk
    try:
        return Case(id=f"case-{uuid4().hex[:8]}", **fields, summary=data.get("summary") or text[:1000],
                    is_emergency=fields.get("severity") == "emergency",
                    evidence=[Evidence(kind=k, uri=u) for k, u in (("photo", photo_uri), ("audio", audio_uri)) if u],
                    property_id=property_id)
    except ValidationError as exc:
        bad = ", ".join(".".join(map(str, e["loc"])) for e in exc.errors())
        raise IntakeError(f"Intake model JSON failed validation on: {bad}") from exc

def analyse_report(text: str, photo_uri: str | None = None, audio_uri: str | None = None,
                   property_id: str | None = None) -> Case:
    try:
        reply = LLMClient(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, model=INTAKE_MODEL).complete(
            # 4096: reasoning models spend tokens thinking first; too few returns empty content
            _build_messages(text, photo_uri, audio_uri), temperature=0, max_tokens=4096,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},  # vLLM/Nemotron: 4-10x faster, accuracy kept by the prompt
            timeout=COMPONENT_TIMEOUT_SECONDS)
    except LLMError as exc:
        raise IntakeError(f"Intake model request failed: {exc}") from exc
    return parse_case(reply["content"], text, photo_uri, audio_uri, property_id)
