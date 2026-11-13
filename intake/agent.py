from importlib import import_module

from backend.config import INTAKE_ADAPTER
from backend.schemas import Case
from .mock import mock_case

def analyse_report(text: str, photo_uri: str | None = None, audio_uri: str | None = None,
                   property_id: str | None = None) -> Case:
    if INTAKE_ADAPTER == "mock":
        return mock_case(text, photo_uri, property_id, audio_uri)
    if INTAKE_ADAPTER == "real":
        try:
            real = import_module("intake.real")
            return Case.model_validate(real.analyse_report(text, photo_uri, audio_uri, property_id))
        except ModuleNotFoundError as exc:
            raise RuntimeError("real intake adapter is not installed; set INTAKE_ADAPTER=mock") from exc
    raise RuntimeError(f"unknown intake adapter: {INTAKE_ADAPTER}")
