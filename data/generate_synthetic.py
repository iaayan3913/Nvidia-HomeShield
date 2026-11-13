import json
from pathlib import Path
WORKERS = [{"id": f"w-{i}", "name": f"Worker {i}", "skills": ["general", "plumbing"], "lat": 53.38 + i*.002, "lon": -1.47} for i in range(1, 9)]
def main():
    Path("data/generated").mkdir(exist_ok=True)
    Path("data/generated/workers.json").write_text(json.dumps(WORKERS, indent=2))
if __name__ == "__main__": main()
