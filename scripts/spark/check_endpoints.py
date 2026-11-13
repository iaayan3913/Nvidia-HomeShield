import os
import urllib.request


ENDPOINTS = {
    "Nano Omni intake": os.getenv("LLM_BASE_URL", "http://127.0.0.1:18000/v1"),
    "Nemotron Lightning agent": os.getenv("AGENT_BASE_URL", "http://127.0.0.1:11434/v1"),
}

for label, base_url in ENDPOINTS.items():
    url = base_url.rstrip("/") + "/models"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            print(f"{label} ({url}): {response.status}")
    except Exception as exc:
        print(f"{label} unavailable at {url}: {type(exc).__name__}: {exc}")
