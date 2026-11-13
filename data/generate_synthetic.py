"""Generate deterministic scheduling fixtures: 8 workers and 36 jobs in Sheffield.

Outputs (timestamps are naive UTC on FIXTURE_DAY; loaders can rebase to today):
  data/generated/workers.json   list[Worker]
  data/generated/jobs.json      list[Job] (+ extra keys property_id, hazard_type, severity)

Priority convention: higher = more urgent (routine 1, moderate 2, significant 3,
emergency 5). Job `latest` is the latest permitted *arrival* time for that visit.
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta

try:
    from data.generate_properties import generate_properties
    from data.sheffield import DISTRICTS, FIXTURE_DAY, GENERATED_DIR, ensure_repo_on_path
except ImportError:  # run as `py data/generate_synthetic.py`
    from generate_properties import generate_properties
    from sheffield import DISTRICTS, FIXTURE_DAY, GENERATED_DIR, ensure_repo_on_path

SEED = 44
DEFAULT_JOBS = 36

# (name, skills, shift start hour, shift end hour, home district)
WORKER_SPECS = [
    ("Amira Hussain", ["general", "damp_mould"], 7, 15, "S5"),
    ("Dan Clarke", ["general", "plumbing", "gas"], 8, 16, "S2"),
    ("Priya Patel", ["electrical", "fire"], 8, 16, "S9"),
    ("Tom Walker", ["gas", "plumbing"], 8, 16, "S14"),
    ("Grace Okafor", ["general", "damp_mould", "plumbing"], 9, 17, "S6"),
    ("Kieran Shaw", ["electrical", "general"], 9, 17, "S12"),
    ("Leah Fletcher", ["general", "damp_mould"], 10, 18, "S4"),
    ("Sam Ahmed", ["general", "fire"], 7, 15, "S13"),
]

HAZARD_SKILL = {"damp_mould": "damp_mould", "leak": "plumbing", "electrical": "electrical",
                "gas": "gas", "fire": "fire", "other": "general"}
# hazard -> (count, duration range minutes)
HAZARD_MIX = {"damp_mould": (12, (60, 90)), "leak": (8, (45, 90)), "other": (7, (30, 60)),
              "electrical": (5, (45, 75)), "gas": (2, (60, 60)), "fire": (2, (45, 45))}
SEVERITY_PRIORITY = {"routine": 1, "moderate": 2, "significant": 3, "emergency": 5}


def _at(hour: float, day: datetime = FIXTURE_DAY) -> datetime:
    return day + timedelta(minutes=round(hour * 60))


def generate_workers(day: datetime = FIXTURE_DAY) -> list[dict]:
    workers = []
    for i, (name, skills, start, end, district) in enumerate(WORKER_SPECS, start=1):
        lat, lon, _, _ = DISTRICTS[district]
        workers.append({
            "id": f"w-{i}", "name": name, "skills": skills,
            "shift_start": _at(start, day).isoformat(), "shift_end": _at(end, day).isoformat(),
            # small offset so workers don't sit exactly on the district centroid
            "lat": round(lat + 0.0012 * ((i % 3) - 1), 6), "lon": round(lon + 0.0015 * ((i % 2) * 2 - 1), 6),
            "home_district": district,
        })
    return workers


def _window(rng: random.Random, severity: str, day: datetime) -> tuple[datetime | None, datetime | None]:
    if severity == "emergency":
        return _at(8, day), _at(10.5, day)
    if severity == "significant":  # investigation deadline falls today
        return None, _at(rng.choice([11, 12, 13, 14, 15]), day)
    slot = rng.choices(["am", "pm", "all_day"], weights=[3, 3, 4])[0]
    if slot == "am":
        return _at(8, day), _at(12, day)
    if slot == "pm":
        return _at(12, day), _at(16.5, day)
    return None, None


def generate_jobs(count: int = DEFAULT_JOBS, seed: int = SEED, day: datetime = FIXTURE_DAY) -> list[dict]:
    rng = random.Random(seed)
    properties = generate_properties()
    sites = rng.sample(properties, count)
    hazards = [h for h, (n, _) in HAZARD_MIX.items() for _ in range(n)]
    while len(hazards) < count:
        hazards.append("damp_mould")
    hazards = hazards[:count]
    rng.shuffle(hazards)
    severities = ["emergency"] + ["significant"] * 7 + ["moderate"] * 12
    severities += ["routine"] * (count - len(severities))
    rng.shuffle(severities)

    jobs = []
    for i, (site, hazard, severity) in enumerate(zip(sites, hazards, severities), start=1):
        earliest, latest = _window(rng, severity, day)
        low, high = HAZARD_MIX[hazard][1]
        jobs.append({
            "id": f"j-{i:03}", "case_id": f"case-seed-{i:03}",
            "required_skill": HAZARD_SKILL[hazard],
            "duration_minutes": rng.randrange(low, high + 1, 15) if high > low else low,
            "lat": site["lat"], "lon": site["lon"],
            "earliest": earliest.isoformat() if earliest else None,
            "latest": latest.isoformat() if latest else None,
            "priority": SEVERITY_PRIORITY[severity],
            "property_id": site["id"], "hazard_type": hazard, "severity": severity,
        })
    return jobs


def main() -> None:
    ensure_repo_on_path()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--jobs", type=int, default=DEFAULT_JOBS)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    workers, jobs = generate_workers(), generate_jobs(args.jobs, args.seed)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    (GENERATED_DIR / "workers.json").write_text(json.dumps(workers, indent=2))
    (GENERATED_DIR / "jobs.json").write_text(json.dumps(jobs, indent=2))
    skills = {}
    for job in jobs:
        skills[job["required_skill"]] = skills.get(job["required_skill"], 0) + 1
    print(f"wrote {len(workers)} workers and {len(jobs)} jobs ({FIXTURE_DAY.date()}): "
          + ", ".join(f"{k}={v}" for k, v in sorted(skills.items())))


if __name__ == "__main__":
    main()
