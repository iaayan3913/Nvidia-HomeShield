"""Deterministic safety guardrails applied after model or mock intake.

This is provisional triage, not an HHSRS or legal determination. It only raises
urgency when the resident's own words contain high-risk combinations that a
multimodal model may have missed.
"""
from __future__ import annotations

import re

from backend.schemas import Case, HazardType, Severity


def _has(text: str, phrases: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(phrase)}\b", text) for phrase in phrases)


def apply_safety_triage(case: Case, report_text: str) -> Case:
    """Conservatively normalise urgent hazards while preserving human review."""
    text = report_text.lower()
    occupants = list(case.vulnerable_occupants)

    child = _has(text, ("child", "baby", "toddler", "infant", "kid")) or bool(
        re.search(r"\b(?:[0-9]|1[0-7])[- ]?year[- ]old\b", text)
    )
    respiratory = _has(text, ("asthma", "copd", "respiratory condition", "lung condition"))
    symptoms = _has(text, ("cough", "coughing", "wheeze", "wheezing", "breathing", "breathless"))
    worsening = _has(text, ("worse", "worsening", "getting worse", "affecting", "triggering"))
    severe_extent = _has(text, ("widespread", "prevalent", "throughout", "every wall", "whole room", "severe mould"))

    if child and "child" not in occupants:
        occupants.append("child")
    if respiratory and "respiratory_condition" not in occupants:
        occupants.append("respiratory_condition")
    case.vulnerable_occupants = occupants

    if case.hazard_type == HazardType.gas:
        case.severity = Severity.emergency
    elif case.hazard_type == HazardType.electrical and _has(
        text, ("exposed wire", "exposed wiring", "bare wire", "live wire", "sparking", "smoke", "burning")
    ):
        case.severity = Severity.emergency
    elif case.hazard_type == HazardType.damp_mould:
        material_health_impact = symptoms
        potential_emergency = material_health_impact or (respiratory and (child or "bedroom" in text))
        if potential_emergency:
            case.severity = Severity.emergency
        elif child or respiratory or severe_extent:
            if case.severity in {Severity.routine, Severity.moderate}:
                case.severity = Severity.significant

    case.is_emergency = case.severity == Severity.emergency
    return case
