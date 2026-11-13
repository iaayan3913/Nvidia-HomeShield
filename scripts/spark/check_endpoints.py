import os, urllib.request
url = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/") + "/models"
try:
    print(urllib.request.urlopen(url, timeout=5).read().decode())
except Exception as exc:
    print(f"Endpoint unavailable: {exc}")
