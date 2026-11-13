"""Build the travel-time matrix used by the scheduler.

  py data/build_travel_matrix.py            # OSMnx if available, else labelled haversine
  py data/build_travel_matrix.py --fallback # force haversine x1.3 at 25 km/h

Points = worker start locations + every property (so emergencies at any
property hit the lookup). Output: data/generated/travel_matrix.json with a
`source` label that the scheduler reports alongside each Plan.
"""
from __future__ import annotations

import argparse
import json
import math
from time import perf_counter

try:
    from data.sheffield import GENERATED_DIR, ensure_repo_on_path, nearest_graph_nodes
except ImportError:  # run as `py data/build_travel_matrix.py`
    from sheffield import GENERATED_DIR, ensure_repo_on_path, nearest_graph_nodes

ensure_repo_on_path()
from data.generate_properties import generate_properties  # noqa: E402
from data.generate_synthetic import generate_workers  # noqa: E402
from scheduler.travel import HAVERSINE_LABEL, haversine_minutes  # noqa: E402


def collect_points() -> list[dict]:
    points = [{"id": w["id"], "lat": w["lat"], "lon": w["lon"]} for w in generate_workers()]
    points += [{"id": p["id"], "lat": p["lat"], "lon": p["lon"]} for p in generate_properties()]
    return points


def haversine_matrix(points: list[dict]) -> list[list[int]]:
    return [[0 if a is b else math.ceil(haversine_minutes((a["lat"], a["lon"]), (b["lat"], b["lon"])))
             for b in points] for a in points]


def osmnx_matrix(points: list[dict]) -> list[list[int]]:
    import networkx as nx
    import osmnx as ox
    ox.settings.cache_folder = str(GENERATED_DIR / "osmnx_cache")  # keep downloads out of the repo root
    graph_path = GENERATED_DIR / "sheffield_drive.graphml"
    if graph_path.exists():
        graph = ox.load_graphml(graph_path)
    else:
        graph = ox.graph_from_place("Sheffield, UK", network_type="drive")
        ox.save_graphml(graph, graph_path)
    graph = ox.add_edge_travel_times(ox.add_edge_speeds(graph))
    nodes = nearest_graph_nodes(graph, [p["lat"] for p in points], [p["lon"] for p in points])
    matrix = []
    for i, source in enumerate(nodes):
        lengths = nx.single_source_dijkstra_path_length(graph, source, weight="travel_time")
        row = []
        for j, target in enumerate(nodes):
            seconds = lengths.get(target)
            if i == j:
                row.append(0)
            elif seconds is None:  # disconnected component: fall back for this pair
                row.append(math.ceil(haversine_minutes((points[i]["lat"], points[i]["lon"]),
                                                       (points[j]["lat"], points[j]["lon"]))))
            else:
                row.append(max(1, math.ceil(seconds / 60)))
        matrix.append(row)
    return matrix


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fallback", action="store_true", help="skip OSMnx and use haversine")
    args = parser.parse_args()
    points = collect_points()
    started = perf_counter()
    source = HAVERSINE_LABEL
    if args.fallback:
        matrix = haversine_matrix(points)
    else:
        try:
            matrix = osmnx_matrix(points)
            source = "osmnx_drive_travel_time"
        except Exception as exc:  # ImportError, network failure, etc.
            print(f"OSMnx path unavailable ({type(exc).__name__}: {exc}); using {HAVERSINE_LABEL}")
            matrix = haversine_matrix(points)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    out = GENERATED_DIR / "travel_matrix.json"
    out.write_text(json.dumps({"source": source, "points": points, "minutes": matrix}))
    print(f"wrote {len(points)}x{len(points)} matrix ({source}) in {perf_counter() - started:.1f}s -> {out}")


if __name__ == "__main__":
    main()
