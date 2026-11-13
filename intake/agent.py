from backend.config import USE_MOCKS
from backend.schemas import Case
from .mock import mock_case

def analyse_report(text: str, photo_uri: str | None = None, audio_uri: str | None = None,
                   property_id: str | None = None) -> Case:
    if USE_MOCKS:
        return mock_case(text, photo_uri, property_id)
    # Real model integration is intentionally isolated behind this stable function.
    return mock_case(text, photo_uri, property_id)
