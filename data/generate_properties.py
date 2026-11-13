import json
from pathlib import Path
def main():
    properties = [{"id": f"p-{i:03}", "lat": 53.34 + (i % 25) * .003, "lon": -1.53 + (i // 25) * .004, "severity": "routine"} for i in range(1, 301)]
    Path("data/generated").mkdir(exist_ok=True)
    Path("data/generated/properties.json").write_text(json.dumps(properties, indent=2))
    Path("frontend/public").mkdir(parents=True, exist_ok=True)
    Path("frontend/public/sample-properties.json").write_text(json.dumps(properties, indent=2))
if __name__ == "__main__": main()
