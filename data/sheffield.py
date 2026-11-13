"""Shared Sheffield geography for the synthetic fixtures.

VERIFY: postcode-district centroids and park outlines below are approximate,
hand-entered values for a demo. They are good enough to put synthetic homes in
plausible residential areas; they are not authoritative geodata.
"""
from __future__ import annotations

import math
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = REPO_ROOT / "data" / "generated"
FRONTEND_PUBLIC = REPO_ROOT / "frontend" / "public"

# Fixture day: the hackathon. Loaders can rebase every timestamp onto "today".
FIXTURE_DAY = datetime(2026, 11, 13)

# district -> (lat, lon, relative share of social-housing stock, area name)
# VERIFY: approximate centroids; weights are illustrative, not council statistics.
DISTRICTS: dict[str, tuple[float, float, float, str]] = {
    "S2": (53.3700, -1.4500, 0.12, "Manor / Park Hill / Norfolk Park"),
    "S3": (53.3880, -1.4800, 0.07, "Netherthorpe / Upperthorpe"),
    "S4": (53.3990, -1.4520, 0.08, "Pitsmoor / Grimesthorpe"),
    "S5": (53.4220, -1.4600, 0.14, "Parson Cross / Firth Park / Shiregreen"),
    "S6": (53.4040, -1.5050, 0.08, "Hillsborough / Walkley"),
    "S7": (53.3530, -1.4980, 0.01, "Nether Edge / Millhouses"),
    "S8": (53.3420, -1.4750, 0.06, "Woodseats / Meersbrook"),
    "S9": (53.3940, -1.4130, 0.08, "Darnall / Attercliffe / Tinsley"),
    "S10": (53.3800, -1.5150, 0.01, "Crookes / Broomhill"),
    "S11": (53.3600, -1.5050, 0.02, "Sharrow / Ecclesall"),
    "S12": (53.3450, -1.4100, 0.07, "Gleadless / Hackenthorpe"),
    "S13": (53.3640, -1.3800, 0.06, "Handsworth / Woodhouse"),
    "S14": (53.3460, -1.4380, 0.10, "Gleadless Valley / Hemsworth"),
    "S20": (53.3350, -1.3550, 0.05, "Mosborough / Beighton"),
    "S35": (53.4600, -1.4700, 0.05, "Chapeltown / Ecclesfield"),
}

# Rough non-residential zones (parks, city-centre core). (lat, lon, radius_m)
# VERIFY: approximate circles, used only to keep synthetic homes out of parks.
EXCLUSION_ZONES: list[tuple[float, float, float, str]] = [
    (53.3811, -1.4701, 450, "City centre core"),
    (53.3380, -1.4690, 550, "Graves Park"),
    (53.3670, -1.5130, 350, "Endcliffe Park"),
    (53.4060, -1.5020, 300, "Hillsborough Park"),
    (53.3690, -1.4430, 300, "Norfolk Heritage Park"),
    (53.3510, -1.4740, 250, "Meersbrook Park"),
    (53.4280, -1.4370, 450, "Concord Park"),
]

# Bounding box used to reject outliers (south, west, north, east).
BBOX = (53.31, -1.56, 53.48, -1.33)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    x = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(x))


def is_plausible_residential(lat: float, lon: float) -> bool:
    south, west, north, east = BBOX
    if not (south <= lat <= north and west <= lon <= east):
        return False
    return all(haversine_km((lat, lon), (zlat, zlon)) * 1000 > radius for zlat, zlon, radius, _ in EXCLUSION_ZONES)


def ensure_repo_on_path() -> None:
    """Let `py data/<script>.py` import `backend`, `scheduler` and `data` modules."""
    root = str(REPO_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
