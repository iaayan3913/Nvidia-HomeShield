from backend.schemas import Case, Evidence, HazardType, Severity
from uuid import uuid4

def mock_case(text: str, photo_uri: str | None = None, property_id: str | None = None) -> Case:
    lower = text.lower()
    if "gas" in lower:
        hazard, severity = HazardType.gas, Severity.emergency
    elif "leak" in lower or "water" in lower:
        hazard, severity = HazardType.leak, Severity.moderate
    elif "electric" in lower or "socket" in lower:
        hazard, severity = HazardType.electrical, Severity.significant
    else:
        hazard, severity = HazardType.damp_mould, Severity.significant
    return Case(id=f"case-{uuid4().hex[:8]}", hazard_type=hazard, severity=severity,
                is_emergency=severity == Severity.emergency, summary=text or "Resident report",
                evidence=[Evidence(kind="photo", uri=photo_uri)] if photo_uri else [], property_id=property_id)
