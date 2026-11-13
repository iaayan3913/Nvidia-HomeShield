import os
from dotenv import load_dotenv
load_dotenv()
USE_MOCKS = os.getenv("USE_MOCKS", "true").lower() == "true"
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "local-model")
INTAKE_MODEL = os.getenv("INTAKE_MODEL", LLM_MODEL)
