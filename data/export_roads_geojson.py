"""Export Sheffield roads to frontend/public/roads.geojson for the offline twin.

  py data/export_roads_geojson.py              # OSMnx drive network (needs osmnx + internet once)
  py data/export_roads_geojson.py --major      # primary..tertiary only -> frontend/public/roads-major.geojson (committed)
  py data/export_roads_geojson.py --fallback   # labelled synthetic skeleton, no dependencies

The OSMnx path also caches data/generated/sheffield_drive.graphml so the travel
matrix and property snapping can reuse it without downloading again.
The fallback is NOT real road geometry: every feature has source="synthetic".
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from data.sheffield import DISTRICTS, FRONTEND_PUBLIC, GENERATED_DIR, haversine_km
except ImportError:  # run as `py data/export_roads_geojson.py`
    from sheffield import DISTRICTS, FRONTEND_PUBLIC, GENERATED_DIR, haversine_km

MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary",
         "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
OUT = FRONTEND_PUBLIC / "roads.geojson"  # full network, gitignored (5-6 MB)
OUT_MAJOR = FRONTEND_PUBLIC / "roads-major.geojson"  # major roads, committed so the twin works after a clone


def _first(value):
    return value[0] if isinstance(value, list) else value


def export_osmnx(major_only: bool) -> dict:
    import osmnx as ox
    ox.settings.cache_folder = str(GENERATED_DIR / "osmnx_cache")  # keep downloads out of the repo root
    graph_path = GENERATED_DIR / "sheffield_drive.graphml"
    if graph_path.exists():
        graph = ox.load_graphml(graph_path)
    else:
        graph = ox.graph_from_place("Sheffield, UK", network_type="drive")
        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        ox.save_graphml(graph, graph_path)
    edges = ox.graph_to_gdfs(graph, nodes=False)
    features, seen = [], set()
    for (u, v, _), row in edges.iterrows():
        if (v, u) in seen:  # drop the reverse direction of two-way streets
            continue
        seen.add((u, v))
        highway = _first(row.get("highway"))
        if major_only and highway not in MAJOR:
            continue
        coords = [[round(x, 5), round(y, 5)] for x, y in row.geometry.coords]
        name = _first(row.get("name"))
        features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                         "properties": {"highway": highway, "name": name if isinstance(name, str) else None}})
    return {"type": "FeatureCollection", "metadata": {"source": "osmnx", "attribution": "© OpenStreetMap contributors"},
            "features": features}


def export_fallback() -> dict:
    """Connect each district centroid to its three nearest neighbours."""
    names = list(DISTRICTS)
    edges = set()
    for a in names:
        pa = DISTRICTS[a][:2]
        nearest = sorted((b for b in names if b != a), key=lambda b: haversine_km(pa, DISTRICTS[b][:2]))[:3]
        edges.update(tuple(sorted((a, b))) for b in nearest)
    features = [{
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[DISTRICTS[a][1], DISTRICTS[a][0]], [DISTRICTS[b][1], DISTRICTS[b][0]]]},
        "properties": {"highway": "synthetic", "name": f"{a}-{b} (synthetic link)", "source": "synthetic"},
    } for a, b in sorted(edges)]
    return {"type": "FeatureCollection",
            "metadata": {"source": "synthetic", "label": "SYNTHETIC fallback: straight links between district centroids, not real roads"},
            "features": features}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--major", action="store_true", help="keep only primary..tertiary roads")
    parser.add_argument("--fallback", action="store_true", help="write the labelled synthetic skeleton")
    parser.add_argument("--out", type=Path, help="output path (default roads.geojson, or roads-major.geojson with --major)")
    args = parser.parse_args()
    collection = None
    if not args.fallback:
        try:
            collection = export_osmnx(args.major)
        except Exception as exc:  # ImportError, no network, etc.
            print(f"VERIFY: OSMnx export failed ({type(exc).__name__}: {exc}); writing synthetic fallback")
    if collection is None:
        collection = export_fallback()
    FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)
    out = args.out or (OUT_MAJOR if args.major else OUT)
    out.write_text(json.dumps(collection))
    size_kb = out.stat().st_size / 1024
    print(f"wrote {len(collection['features'])} road features ({collection['metadata']['source']}, {size_kb:.0f} KB) -> {out}")


if __name__ == "__main__":
    main()
