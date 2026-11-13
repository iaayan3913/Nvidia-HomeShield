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
SCHEDULER_ADAPTER = os.getenv("SCHEDULER_ADAPTER", "mock" if USE_MOCKS else "ortools").lower()
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "local-model")
INTAKE_MODEL = os.getenv("INTAKE_MODEL", LLM_MODEL)
NEMOCLAW_URL = os.getenv("NEMOCLAW_URL", "")
COMPONENT_TIMEOUT_SECONDS = float(os.getenv("COMPONENT_TIMEOUT_SECONDS", "20"))
AGENT_MAX_ITERATIONS = int(os.getenv("AGENT_MAX_ITERATIONS", "8"))
CORS_ORIGINS = [v.strip() for v in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if v.strip()]
