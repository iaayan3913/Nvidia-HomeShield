"""Send the demo photos + report texts to the configured real model: py -3.13 -m intake.try_live

Reads LLM_BASE_URL / LLM_API_KEY / INTAKE_MODEL from .env. A voice note named like the photo
(e.g. demo-photos/socket.wav or .mp3) is sent too, if present.
"""
import sys
from pathlib import Path
from time import perf_counter
from backend.config import INTAKE_MODEL, LLM_BASE_URL
from intake.real import IntakeError, analyse_report

DEMO = Path(__file__).resolve().parents[1] / "demo-photos"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252; model text can include Unicode

print(f"Model {INTAKE_MODEL} at {LLM_BASE_URL}\n")
for block in (DEMO / "reports.txt").read_text(encoding="utf-8").strip().split("\n\n"):
    header, text = block.strip().split("\n", 1)
    photo = DEMO / header.split()[0]
    audio = next((p for ext in ("wav", "mp3") if (p := photo.with_suffix(f".{ext}")).is_file()), None)
    print(f"{photo.name}{' + ' + audio.name if audio else ''}  {header[len(photo.name):].strip()}")
    started = perf_counter()
    try:
        case = analyse_report(text, str(photo), str(audio) if audio else None)
        print(f"  got: {case.hazard_type.value}, {case.severity.value}, emergency={case.is_emergency}, "
              f"room={case.room}, vulnerable={case.vulnerable_occupants}\n  summary: {case.summary}")
    except IntakeError as exc:
        print(f"  FAILED: {exc}")
    print(f"  took {perf_counter() - started:.1f}s\n")
