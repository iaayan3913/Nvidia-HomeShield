"""Generate a deterministic synthetic social-housing stock for the Sheffield twin.

Outputs:
  data/generated/properties.json        list of property dicts (backend/scheduler use)
  frontend/public/properties.geojson    Point FeatureCollection for deck.gl
  frontend/public/sample-properties.json same list as properties.json (legacy name)

Properties are clustered around residential postcode districts, kept out of
parks and the city-centre core, and optionally snapped to the OSMnx road graph
(`--snap`) when `data/generated/sheffield_drive.graphml` exists.
"""
from __future__ import annotations

import argparse
import json
import random

try:
    from data.sheffield import (DISTRICTS, FRONTEND_PUBLIC, GENERATED_DIR, ensure_repo_on_path,
                                is_plausible_residential, nearest_graph_nodes)
except ImportError:  # run as `py data/generate_properties.py`
    from sheffield import (DISTRICTS, FRONTEND_PUBLIC, GENERATED_DIR, ensure_repo_on_path, is_plausible_residential,
                           nearest_graph_nodes)

SEED = 4
DEFAULT_COUNT = 400

# archetype -> (weight, floors range, bedrooms range, build-year range)
ARCHETYPES = {
    "low_rise_flat": (0.30, (2, 4), (1, 2), (1950, 1975)),
    "maisonette": (0.12, (3, 4), (2, 3), (1960, 1975)),
    "high_rise_flat": (0.08, (8, 16), (1, 2), (1960, 1972)),
    "terrace": (0.25, (2, 2), (2, 3), (1900, 1939)),
    "semi_detached": (0.20, (2, 2), (2, 4), (1925, 1960)),
    "bungalow": (0.05, (1, 1), (1, 2), (1960, 1990)),
}


def _weighted_choice(rng: random.Random, options: dict, weight_of) -> str:
    keys = list(options)
    return rng.choices(keys, weights=[weight_of(options[k]) for k in keys], k=1)[0]


def generate_properties(count: int = DEFAULT_COUNT, seed: int = SEED) -> list[dict]:
    rng = random.Random(seed)
    properties: list[dict] = []
    attempts = 0
    while len(properties) < count:
        attempts += 1
        if attempts > count * 50:
            raise RuntimeError("Could not place properties; check DISTRICTS/EXCLUSION_ZONES")
        district = _weighted_choice(rng, DISTRICTS, lambda d: d[2])
        clat, clon, _, area = DISTRICTS[district]
        # ~650 m spread around the district centroid.
        lat = round(rng.gauss(clat, 0.0058), 6)
        lon = round(rng.gauss(clon, 0.0095), 6)
        if not is_plausible_residential(lat, lon):
            continue
        archetype = _weighted_choice(rng, ARCHETYPES, lambda a: a[0])
        _, floors, bedrooms, years = ARCHETYPES[archetype]
        index = len(properties) + 1
        properties.append({
            "id": f"p-{index:03}",
            "lat": lat,
            "lon": lon,
            "district": district,
            "area": area,
            "archetype": archetype,
            "floors": rng.randint(*floors),
            "bedrooms": rng.randint(*bedrooms),
            "built_year": rng.randint(*years),
            "severity": "routine",
            "synthetic": True,
        })
    return properties


def snap_to_roads(properties: list[dict]) -> int:
    """Snap each property to its nearest drivable OSM node. Returns the count snapped."""
    graph_path = GENERATED_DIR / "sheffield_drive.graphml"
    try:
        import osmnx as ox
    except ImportError:
        print("osmnx not installed; skipping snap")
        return 0
    if not graph_path.exists():
        print(f"{graph_path} missing; run data/export_roads_geojson.py first; skipping snap")
        return 0
    graph = ox.load_graphml(graph_path)
    nodes = nearest_graph_nodes(graph, [p["lat"] for p in properties], [p["lon"] for p in properties])
    for prop, node in zip(properties, nodes):
        data = graph.nodes[node]
        prop["lat"], prop["lon"] = round(data["y"], 6), round(data["x"], 6)
        prop["snapped"] = True
    return len(properties)


def to_geojson(properties: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "metadata": {"source": "synthetic", "label": "Synthetic social-housing stock (not real addresses)"},
        "features": [{
            "type": "Feature",
            "id": p["id"],
            "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
            "properties": {k: v for k, v in p.items() if k not in ("lat", "lon")},
        } for p in properties],
    }


def write_outputs(properties: list[dict]) -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(properties, indent=2)
    (GENERATED_DIR / "properties.json").write_text(payload)
    (FRONTEND_PUBLIC / "sample-properties.json").write_text(payload)
    (FRONTEND_PUBLIC / "properties.geojson").write_text(json.dumps(to_geojson(properties)))


def main() -> None:
    ensure_repo_on_path()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="300-500 recommended")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--snap", action="store_true", help="snap to OSMnx road nodes if available")
    args = parser.parse_args()
    properties = generate_properties(args.count, args.seed)
    if args.snap:
        print(f"snapped {snap_to_roads(properties)} properties to road nodes")
    write_outputs(properties)
    by_district: dict[str, int] = {}
    for p in properties:
        by_district[p["district"]] = by_district.get(p["district"], 0) + 1
    print(f"wrote {len(properties)} properties: " + ", ".join(f"{k}={v}" for k, v in sorted(by_district.items())))


if __name__ == "__main__":
    main()
