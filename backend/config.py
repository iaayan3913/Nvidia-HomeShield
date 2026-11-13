import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).resolve().parents[1]
USE_MOCKS = env_bool("USE_MOCKS", True)
DEMO_SEED = env_bool("DEMO_SEED", False)
DATABASE_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR / "homeshield.sqlite3"))
RULES_PATH = os.getenv("RULES_PATH", str(BASE_DIR / "agent" / "rules" / "awaabs_law.yaml"))
AGENT_RUNTIME = os.getenv("AGENT_RUNTIME", "mock" if USE_MOCKS else "python").lower()
INTAKE_ADAPTER = os.getenv("INTAKE_ADAPTER", "mock" if USE_MOCKS else "real").lower()
UPLOAD_DIRECTORY = os.getenv("UPLOAD_DIRECTORY", str(BASE_DIR / "data" / "uploads"))
MAX_PHOTO_UPLOAD_BYTES = int(os.getenv("MAX_PHOTO_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_AUDIO_UPLOAD_BYTES = int(os.getenv("MAX_AUDIO_UPLOAD_BYTES", str(25 * 1024 * 1024)))
INTAKE_AUDIO_ENABLED = env_bool("INTAKE_AUDIO_ENABLED", False)
SCHEDULER_ADAPTER = os.getenv("SCHEDULER_ADAPTER", "mock" if USE_MOCKS else "ortools").lower()
SCHEDULER_TIME_LIMIT_S = float(os.getenv("SCHEDULER_TIME_LIMIT_S", "1.0"))
SCHEDULER_SEED_JOBS = env_bool("SCHEDULER_SEED_JOBS", True)
# Nano Omni intake endpoint. Kept under the established names for Person 2 compatibility.
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:18000/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "local-model")
INTAKE_MODEL = os.getenv("INTAKE_MODEL", LLM_MODEL)
# Nemotron Lightning endpoint for the plain-Python agent fallback.
AGENT_BASE_URL = os.getenv("AGENT_BASE_URL", "http://127.0.0.1:11434/v1")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", LLM_API_KEY)
AGENT_MODEL = os.getenv("AGENT_MODEL", LLM_MODEL)
NEMOCLAW_URL = os.getenv("NEMOCLAW_URL", "")
COMPONENT_TIMEOUT_SECONDS = float(os.getenv("COMPONENT_TIMEOUT_SECONDS", "20"))
AGENT_MAX_ITERATIONS = int(os.getenv("AGENT_MAX_ITERATIONS", "8"))
CORS_ORIGINS = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if v.strip()]
