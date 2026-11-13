"""Travel-time model shared by every solver.

If `data/generated/travel_matrix.json` exists (built by data/build_travel_matrix.py,
ideally from OSMnx road travel times) its entries are used for known points.
Any other pair falls back to the clearly labelled synthetic estimate:
haversine distance x 1.3 detour factor at an average 25 km/h.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

DETOUR_FACTOR = 1.3
AVERAGE_KMH = 25.0
HAVERSINE_LABEL = "haversine_x1.3_at_25kmh"
MATRIX_PATH = Path(__file__).resolve().parents[1] / "data" / "generated" / "travel_matrix.json"

Point = tuple[float, float]


def haversine_km(a: Point, b: Point) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    x = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(x))


def haversine_minutes(a: Point, b: Point) -> float:
    return haversine_km(a, b) * DETOUR_FACTOR / AVERAGE_KMH * 60


def _key(p: Point) -> tuple[float, float]:
    return round(p[0], 5), round(p[1], 5)


class TravelModel:
    def __init__(self, lookup: dict[tuple, dict[tuple, float]] | None = None, source: str = HAVERSINE_LABEL):
        self._lookup = lookup or {}
        self.source = source if lookup else HAVERSINE_LABEL

    @classmethod
    def load(cls, path: Path = MATRIX_PATH) -> "TravelModel":
        if not path.exists():
            return cls()
        try:
            data = json.loads(path.read_text())
            keys = [_key((p["lat"], p["lon"])) for p in data["points"]]
            lookup = {a: dict(zip(keys, row)) for a, row in zip(keys, data["minutes"])}
            return cls(lookup, data.get("source", "precomputed"))
        except (OSError, ValueError, KeyError) as exc:
            print(f"travel matrix unreadable ({exc}); using {HAVERSINE_LABEL}")
            return cls()

    def minutes(self, a: Point, b: Point) -> float:
        row = self._lookup.get(_key(a))
        if row is not None:
            value = row.get(_key(b))
            if value is not None:
                return float(value)
        return haversine_minutes(a, b)

    def matrix(self, points: list[Point]) -> tuple[list[list[int]], str]:
        """Whole-minute matrix plus a label saying where the numbers came from."""
        fallback_used = False
        rows = []
        for a in points:
            row = []
            for b in points:
                if a == b:
                    row.append(0)
                    continue
                known = self._lookup.get(_key(a), {}).get(_key(b))
                fallback_used |= known is None
                row.append(math.ceil(known if known is not None else haversine_minutes(a, b)))
            rows.append(row)
        if not self._lookup:
            label = HAVERSINE_LABEL
        elif fallback_used:
            label = f"{self.source}+{HAVERSINE_LABEL}"
        else:
            label = self.source
        return rows, label


_DEFAULT: TravelModel | None = None


def default_model() -> TravelModel:
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = TravelModel.load()
    return _DEFAULT
