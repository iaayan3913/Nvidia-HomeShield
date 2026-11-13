"""Export OSMnx roads when available; the committed sample remains the offline fallback."""
import json
from pathlib import Path
def main():
    try:
        import osmnx as ox
    except ImportError:
        print("VERIFY: install osmnx on the current architecture; keeping sample roads")
        return
    graph = ox.graph_from_place("Sheffield, UK", network_type="drive")
    Path("frontend/public").mkdir(parents=True, exist_ok=True)
    Path("frontend/public/roads.geojson").write_text(ox.graph_to_gdfs(graph, nodes=False).to_json())
if __name__ == "__main__": main()
