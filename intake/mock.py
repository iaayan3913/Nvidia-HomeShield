from backend.schemas import Case, Evidence, HazardType, Severity
from uuid import uuid4

def mock_case(text: str, photo_uri: str | None = None, property_id: str | None = None,
              audio_uri: str | None = None) -> Case:
    lower = text.lower()
    if "gas" in lower:
        hazard, severity = HazardType.gas, Severity.emergency
    elif "leak" in lower or "water" in lower:
        hazard, severity = HazardType.leak, Severity.moderate
    elif any(w in lower for w in ("electric", "socket", "wire")):
        danger = any(w in lower for w in ("bare wire", "exposed", "burn", "scorch", "spark", "smoke"))
        hazard, severity = HazardType.electrical, Severity.emergency if danger else Severity.significant
    else:
        hazard, severity = HazardType.damp_mould, Severity.significant
    vulnerable = [label for label, words in (("child", ("child", "kid", "baby", "toddler", "year-old")),
                                             ("elderly", ("elderly", "pensioner", "grandparent")),
                                             ("respiratory_condition", ("asthma", "breathing", "respiratory", "copd")))
                  if any(w in lower for w in words)]
    symptoms = any(w in lower for w in ("cough", "wheez", "chest infection"))
    if hazard == HazardType.damp_mould and ("respiratory_condition" in vulnerable or symptoms):
        severity = Severity.emergency  # VERIFY: Awaab's Law Phase 2 triage guidance - vulnerable or already symptomatic
    room = next((r for r in ("bedroom", "kitchen", "living room", "bathroom", "hallway") if r in lower), None)
    evidence = [Evidence(kind=kind, uri=uri) for kind, uri in (("photo", photo_uri), ("audio", audio_uri)) if uri]
    return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=hazard, severity=severity,
                is_emergency=severity == Severity.emergency, summary=text[:1000] or "Resident report",
                evidence=evidence, property_id=property_id, room=room, vulnerable_occupants=vulnerable)
