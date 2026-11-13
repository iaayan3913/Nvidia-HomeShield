import base64, json, logging, mimetypes
from pathlib import Path
from pydantic import BaseModel, ValidationError
from backend.config import INTAKE_MODEL, USE_MOCKS
from backend.llm_client import LLMClient, LLMError
from backend.schemas import Case, HazardType, Severity
from .mock import mock_case

log = logging.getLogger(__name__)

class IntakeError(RuntimeError): pass

class Extraction(BaseModel):
    """What the model may fill in; anything it omits stays null (or falls back to the keyword guess)."""
    hazard_type: HazardType | None = None
    hhsrs_category: str | None = None
    severity: Severity | None = None
    is_emergency: bool | None = None
    room: str | None = None
    vulnerable_occupants: list[str] | None = None
    summary: str | None = None

PROMPT = """You are a social-housing repairs triage assistant. Read the resident's report (and any photo or audio) and extract housing hazards.
Reply with ONE JSON object only, no prose, using exactly these keys:
{"hazard_type": "damp_mould|leak|electrical|gas|fire|other",
 "hhsrs_category": "HHSRS hazard name, e.g. 'Damp and mould growth', or null",
 "severity": "routine|moderate|significant|emergency",
 "is_emergency": true or false (immediate risk to health or safety, e.g. gas smell, exposed live wiring, fire, major flooding),
 "room": "room name or null",
 "vulnerable_occupants": ["child", "elderly", "disabled", "pregnant", "respiratory_condition"] or [],
 "summary": "one neutral sentence describing the hazard"}
Use null for anything the report does not state. Never include names, phone numbers, emails or addresses in any field."""

def _media_bytes(uri: str) -> tuple[bytes, str] | None:
    # shortcut: only local files (optionally "upload://" prefixed) are read; switch to the backend's upload store once Person 3 defines it.
    path = Path(uri.removeprefix("upload://"))
    if not path.is_file():
        return None
    return path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream"

def _build_messages(text: str, photo_uri: str | None, audio_uri: str | None) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": f"Resident report:\n{text or '(no text provided)'}"}]
    if photo_uri:
        if photo_uri.startswith(("http://", "https://", "data:")):
            content.append({"type": "image_url", "image_url": {"url": photo_uri}})
        elif media := _media_bytes(photo_uri):
            data, mime = media
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}})
    if audio_uri and (media := _media_bytes(audio_uri)):
        # VERIFY: Nano Omni's accepted audio part/format; this is the OpenAI input_audio shape.
        data, mime = media
        content.append({"type": "input_audio", "input_audio": {"data": base64.b64encode(data).decode(),
                                                               "format": mime.split("/")[-1].removeprefix("x-")}})
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": content}]

def parse_extraction(raw: str) -> Extraction:
    """Validate model output; raises IntakeError without echoing report content (no personal data in logs)."""
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end < start:
        raise IntakeError("Intake model did not return a JSON object")
    try:
        return Extraction.model_validate(json.loads(raw[start:end + 1]))
    except json.JSONDecodeError as exc:
        raise IntakeError(f"Intake model returned invalid JSON at char {exc.pos}") from exc
    except ValidationError as exc:
        fields = ", ".join(".".join(map(str, e["loc"])) for e in exc.errors())
        raise IntakeError(f"Intake model JSON failed validation on: {fields}") from exc

def analyse_report(text: str, photo_uri: str | None = None, audio_uri: str | None = None,
                   property_id: str | None = None) -> Case:
    base = mock_case(text, photo_uri, property_id, audio_uri)
    if USE_MOCKS:
        return base
    try:
        reply = LLMClient(model=INTAKE_MODEL).complete(_build_messages(text, photo_uri, audio_uri), temperature=0)
        extraction = parse_extraction(reply["content"])
    except (LLMError, IntakeError) as exc:
        log.warning("Intake model unavailable, using offline text-only fallback: %s", exc)
        return base
    case = base.model_copy(update=extraction.model_dump(exclude_none=True))
    case.is_emergency = bool(extraction.is_emergency) or case.severity == Severity.emergency
    return case
