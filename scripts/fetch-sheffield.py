#!/usr/bin/env python3
"""Fetch OpenStreetMap buildings, roads and place labels for central Sheffield.

Writes compact GeoJSON for the Operations digital twin's local/offline mode:

    frontend/public/data/sheffield-buildings.geojson
    frontend/public/data/sheffield-roads.geojson
    frontend/public/data/sheffield-places.geojson

Usage (from the repository root):

    py -3.13 scripts/fetch-sheffield.py                    # 3.5 km around the city centre
    py -3.13 scripts/fetch-sheffield.py --radius 5000
    py -3.13 scripts/fetch-sheffield.py --center 53.38,-1.47 --out frontend/public/data
    py -3.13 scripts/fetch-sheffield.py --source openfreemap   # when no Overpass server is reachable
    py -3.13 scripts/fetch-sheffield.py --endpoint https://maps.mail.ru/osm/tools/overpass/api/interpreter

Standard library only. Data © OpenStreetMap contributors, available under the ODbL 1.0.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import struct
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_CENTER = (53.3811, -1.4701)  # Sheffield city centre
DEFAULT_RADIUS_M = 3500
DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter"
USER_AGENT = "HomeShield-digital-twin/1.0 (+https://github.com/iaayan3913/Nvidia-HomeShield; data fetch script)"
ATTRIBUTION = "© OpenStreetMap contributors. Data available under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright"
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
                "living_street", "service", "pedestrian", "motorway_link", "trunk_link", "primary_link",
                "secondary_link", "tertiary_link")
PLACE_CLASSES = ("city", "town", "suburb", "quarter", "neighbourhood", "village", "hamlet")
STOREY_M = 3.0
DEFAULT_HEIGHT_M = 6.0


def overpass(query: str, endpoint: str, attempts: int = 4, timeout: int = 240) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(endpoint, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            wait = 10 * 2 ** (attempt - 1)
            print(f"  attempt {attempt}/{attempts} failed: {error}", file=sys.stderr)
            if attempt == attempts:
                raise SystemExit(f"Overpass request failed after {attempts} attempts. Try again later or use --endpoint.")
            print(f"  retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def number(value: str | None) -> float | None:
    """Parse OSM numeric tags such as '12', '12.5 m', '3;4' (first value wins)."""
    if not value:
        return None
    match = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", value.split(";")[0])
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except ValueError:
        return None


def ring(geometry: list[dict], digits: int) -> list[list[float]]:
    return [[round(point["lon"], digits), round(point["lat"], digits)] for point in geometry]


def closed(points: list[list[float]]) -> bool:
    return len(points) >= 4 and points[0] == points[-1]


def stitch(parts: list[list[list[float]]]) -> list[list[list[float]]]:
    """Join unclosed multipolygon member ways end-to-end into closed rings."""
    rings, pending = [], [p for p in parts if len(p) >= 2]
    while pending:
        current = pending.pop(0)
        progress = True
        while not closed(current) and progress:
            progress = False
            for index, part in enumerate(pending):
                if part[0] == current[-1]:
                    current = current + part[1:]
                elif part[-1] == current[-1]:
                    current = current + part[::-1][1:]
                elif part[-1] == current[0]:
                    current = part + current[1:]
                elif part[0] == current[0]:
                    current = part[::-1] + current[1:]
                else:
                    continue
                pending.pop(index)
                progress = True
                break
        if closed(current):
            rings.append(current)
    return rings


def inside(point: list[float], polygon: list[list[float]]) -> bool:
    x, y = point
    result = False
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            result = not result
    return result


def building_properties(tags: dict) -> dict:
    levels = number(tags.get("building:levels"))
    min_level = number(tags.get("building:min_level"))
    roof_levels = number(tags.get("roof:levels")) or 0
    height = number(tags.get("height"))
    if height is None and levels is not None:
        height = (levels + roof_levels) * STOREY_M
    min_height = number(tags.get("min_height"))
    if min_height is None and min_level is not None:
        min_height = min_level * STOREY_M
    props = {"height": round(height if height and height > 0 else DEFAULT_HEIGHT_M, 1),
             "min_height": round(max(0.0, min_height or 0.0), 1)}
    if levels is not None:
        props["levels"] = levels
    if tags.get("building") and tags["building"] != "yes":
        props["building"] = tags["building"]
    if tags.get("name"):
        props["name"] = tags["name"]
    return props


def buildings(data: dict, digits: int) -> list[dict]:
    features = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if element["type"] == "way" and element.get("geometry"):
            outer = ring(element["geometry"], digits)
            if not closed(outer):
                continue
            geometry = {"type": "Polygon", "coordinates": [outer]}
        elif element["type"] == "relation" and tags.get("type") == "multipolygon":
            members = [m for m in element.get("members", []) if m.get("geometry")]
            outers = stitch([ring(m["geometry"], digits) for m in members if m.get("role") != "inner"])
            inners = stitch([ring(m["geometry"], digits) for m in members if m.get("role") == "inner"])
            if not outers:
                continue
            polygons = [[outer] for outer in outers]
            for hole in inners:
                owner = next((p for p in polygons if inside(hole[0], p[0])), None)
                if owner:
                    owner.append(hole)
            geometry = {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {"type": "MultiPolygon", "coordinates": polygons}
        else:
            continue
        features.append({"type": "Feature", "id": f"{element['type'][0]}{element['id']}",
                         "geometry": geometry, "properties": building_properties(tags)})
    return features


def roads(data: dict, digits: int) -> list[dict]:
    features = []
    for element in data.get("elements", []):
        if element["type"] != "way" or not element.get("geometry"):
            continue
        tags = element.get("tags", {})
        props = {"highway": tags.get("highway", "road")}
        if tags.get("name"):
            props["name"] = tags["name"]
        if tags.get("ref"):
            props["ref"] = tags["ref"]
        features.append({"type": "Feature", "id": f"w{element['id']}",
                         "geometry": {"type": "LineString", "coordinates": ring(element["geometry"], digits)},
                         "properties": props})
    return features


def places(data: dict, digits: int) -> list[dict]:
    features = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if element["type"] != "node" or not tags.get("name"):
            continue
        features.append({"type": "Feature", "id": f"n{element['id']}",
                         "geometry": {"type": "Point", "coordinates": [round(element["lon"], digits), round(element["lat"], digits)]},
                         "properties": {"name": tags["name"], "place": tags.get("place", "locality")}})
    return features


def write(path: Path, features: list[dict], label: str, center: tuple[float, float], radius: int,
          attribution: str = ATTRIBUTION, source: str = "openstreetmap-overpass") -> None:
    collection = {"type": "FeatureCollection", "metadata": {
        "source": source, "label": label, "attribution": attribution,
        "licence": "ODbL-1.0", "center": [center[1], center[0]], "radius_m": radius,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "scripts/fetch-sheffield.py"}, "features": features}
    path.write_text(json.dumps(collection, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    size = path.stat().st_size
    flag = "  (over 25 MB: do not commit; regenerate locally)" if size > 25 * 1024 * 1024 else ""
    print(f"  wrote {path} · {len(features):,} features · {size / 1_048_576:.1f} MB{flag}")


# ---------------------------------------------------------------- OpenFreeMap vector tiles (alternative source)
OFM_TILEJSON = "https://tiles.openfreemap.org/planet"
OFM_ATTRIBUTION = "OpenFreeMap © OpenMapTiles Data from OpenStreetMap (© OpenStreetMap contributors, ODbL 1.0)"
OFM_ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service")


def http_get(url: str, attempts: int = 4) -> bytes:
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            if attempt == attempts:
                raise SystemExit(f"Could not fetch {url}: {error}")
            time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def _varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def _fields(buf: bytes):
    """Yield (field_number, wire_type, value) for a protobuf message; length-delimited values are bytes."""
    pos = 0
    while pos < len(buf):
        key, pos = _varint(buf, pos)
        field, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = _varint(buf, pos)
        elif wire == 1:
            value, pos = buf[pos:pos + 8], pos + 8
        elif wire == 2:
            length, pos = _varint(buf, pos)
            value, pos = buf[pos:pos + length], pos + length
        elif wire == 5:
            value, pos = buf[pos:pos + 4], pos + 4
        else:
            raise ValueError(f"unsupported wire type {wire}")
        yield field, wire, value


def _packed(buf: bytes) -> list[int]:
    out, pos = [], 0
    while pos < len(buf):
        value, pos = _varint(buf, pos)
        out.append(value)
    return out


def _value(buf: bytes):
    for field, _wire, value in _fields(buf):
        if field == 1:
            return value.decode("utf-8")
        if field == 2:
            return struct.unpack("<f", value)[0]
        if field == 3:
            return struct.unpack("<d", value)[0]
        if field in (4, 5):
            return value
        if field == 6:
            return (value >> 1) ^ -(value & 1)
        if field == 7:
            return bool(value)
    return None


def decode_tile(data: bytes) -> dict[str, list[dict]]:
    """Minimal Mapbox Vector Tile v2 decoder: {layer: [{type, props, rings, extent}]} in tile coordinates."""
    layers: dict[str, list[dict]] = {}
    for field, _wire, layer_buf in _fields(data):
        if field != 3:
            continue
        name, keys, values, features, extent = "", [], [], [], 4096
        for lf, _lw, lv in _fields(layer_buf):
            if lf == 1:
                name = lv.decode("utf-8")
            elif lf == 2:
                features.append(lv)
            elif lf == 3:
                keys.append(lv.decode("utf-8"))
            elif lf == 4:
                values.append(_value(lv))
            elif lf == 5:
                extent = lv
        decoded = []
        for feature_buf in features:
            geom_type, tags, geometry = 0, [], []
            for ff, _fw, fv in _fields(feature_buf):
                if ff == 2:
                    tags = _packed(fv)
                elif ff == 3:
                    geom_type = fv
                elif ff == 4:
                    geometry = _packed(fv)
            props = {keys[tags[i]]: values[tags[i + 1]] for i in range(0, len(tags) - 1, 2)}
            rings, ring, x, y, i = [], [], 0, 0, 0
            while i < len(geometry):
                command, count = geometry[i] & 7, geometry[i] >> 3
                i += 1
                if command in (1, 2):
                    for _ in range(count):
                        dx, dy = geometry[i], geometry[i + 1]
                        i += 2
                        x += (dx >> 1) ^ -(dx & 1)
                        y += (dy >> 1) ^ -(dy & 1)
                        if command == 1 and ring:
                            rings.append(ring)
                            ring = []
                        ring.append((x, y))
                elif command == 7 and ring:
                    ring.append(ring[0])
            if ring:
                rings.append(ring)
            decoded.append({"type": geom_type, "props": props, "rings": rings, "extent": extent})
        layers[name] = decoded
    return layers


def tile_range(lat: float, lon: float, radius: int, zoom: int) -> list[tuple[int, int]]:
    dlat = radius / 110_574
    dlon = radius / (111_320 * math.cos(math.radians(lat)))

    def tile(la: float, lo: float) -> tuple[int, int]:
        n = 2 ** zoom
        return int((lo + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n)

    x0, y0 = tile(lat + dlat, lon - dlon)
    x1, y1 = tile(lat - dlat, lon + dlon)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def to_lonlat(tx: int, ty: int, zoom: int, extent: int, point: tuple[int, int], digits: int) -> list[float]:
    n = 2 ** zoom
    lon = (tx + point[0] / extent) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + point[1] / extent) / n))))
    return [round(lon, digits), round(lat, digits)]


def _area(ring: list[tuple[int, int]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def inside_radius(coord: list[float], lat: float, lon: float, radius: int) -> bool:
    dy = (coord[1] - lat) * 110_574
    dx = (coord[0] - lon) * 111_320 * math.cos(math.radians(lat))
    return math.hypot(dx, dy) <= radius


def fetch_openfreemap(lat: float, lon: float, radius: int, places_radius: int, digits: int, pause: float):
    tilejson = json.loads(http_get(OFM_TILEJSON).decode("utf-8"))
    template, zoom = tilejson["tiles"][0], int(tilejson.get("maxzoom", 14))
    buildings_out, roads_out, places_out, seen_places = [], [], [], set()
    tiles = tile_range(lat, lon, max(radius, places_radius), zoom)
    building_tiles = set(tile_range(lat, lon, radius, zoom))
    for index, (tx, ty) in enumerate(tiles, start=1):
        print(f"  tile {index}/{len(tiles)} ({zoom}/{tx}/{ty})", flush=True)
        layers = decode_tile(http_get(template.replace("{z}", str(zoom)).replace("{x}", str(tx)).replace("{y}", str(ty))))
        if (tx, ty) in building_tiles:
            for feature in layers.get("building", []):
                if feature["type"] != 3 or feature["props"].get("hide_3d"):
                    continue
                polygons = []
                for ring in feature["rings"]:
                    if len(ring) < 4:
                        continue
                    coords = [to_lonlat(tx, ty, zoom, feature["extent"], p, digits) for p in ring]
                    if _area(ring) > 0 or not polygons:
                        polygons.append([coords])
                    else:
                        polygons[-1].append(coords)
                props = {"height": round(float(feature["props"].get("render_height") or DEFAULT_HEIGHT_M), 1),
                         "min_height": round(float(feature["props"].get("render_min_height") or 0), 1)}
                # Tiles merge buildings that share attributes into one multipolygon; emit one feature per building.
                for polygon in polygons:
                    if inside_radius(polygon[0][0], lat, lon, radius):
                        buildings_out.append({"type": "Feature", "id": f"t{tx}-{ty}-{len(buildings_out)}",
                                              "geometry": {"type": "Polygon", "coordinates": polygon}, "properties": dict(props)})
            for feature in layers.get("transportation", []):
                road_class = feature["props"].get("class")
                if feature["type"] != 2 or road_class not in OFM_ROAD_CLASSES:
                    continue
                for ring in feature["rings"]:
                    coords = [to_lonlat(tx, ty, zoom, feature["extent"], p, digits) for p in ring]
                    if len(coords) >= 2 and inside_radius(coords[0], lat, lon, radius):
                        roads_out.append({"type": "Feature", "id": f"r{len(roads_out)}", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"highway": road_class}})
        for feature in layers.get("place", []):
            name = feature["props"].get("name_en") or feature["props"].get("name")
            place = feature["props"].get("class")
            if feature["type"] != 1 or not name or place not in PLACE_CLASSES or name in seen_places or not feature["rings"]:
                continue
            coords = to_lonlat(tx, ty, zoom, feature["extent"], feature["rings"][0][0], digits)
            if inside_radius(coords, lat, lon, places_radius):
                seen_places.add(name)
                places_out.append({"type": "Feature", "id": f"p{len(places_out)}", "geometry": {"type": "Point", "coordinates": coords}, "properties": {"name": name, "place": place}})
        time.sleep(pause)
    return buildings_out, roads_out, places_out


def tiled(query_body: str, lat: float, lon: float, radius: int, tiles: int, endpoint: str, pause: float) -> dict:
    """Run `query_body` (with a {bbox} placeholder) over a tiles × tiles grid covering the circle; merge by id."""
    dlat = radius / 110_574
    dlon = radius / (111_320 * math.cos(math.radians(lat)))
    south, west = lat - dlat, lon - dlon
    step_lat, step_lon = 2 * dlat / tiles, 2 * dlon / tiles
    merged: dict[tuple[str, int], dict] = {}
    for row in range(tiles):
        for col in range(tiles):
            s, w = south + row * step_lat, west + col * step_lon
            bbox = f"{s:.6f},{w:.6f},{s + step_lat:.6f},{w + step_lon:.6f}"
            print(f"  tile {row * tiles + col + 1}/{tiles * tiles}", flush=True)
            for element in overpass(query_body.replace("{bbox}", bbox), endpoint).get("elements", []):
                merged[(element["type"], element["id"])] = element
            time.sleep(pause)
    return {"elements": list(merged.values())}


def within(element: dict, lat: float, lon: float, radius: int) -> bool:
    """Keep elements whose first vertex (or node position) lies inside the requested circle."""
    if "lat" in element:
        point = (element["lat"], element["lon"])
    elif element.get("geometry"):
        point = (element["geometry"][0]["lat"], element["geometry"][0]["lon"])
    elif element.get("members"):
        first = next((m for m in element["members"] if m.get("geometry")), None)
        if not first:
            return False
        point = (first["geometry"][0]["lat"], first["geometry"][0]["lon"])
    else:
        return False
    dy = (point[0] - lat) * 110_574
    dx = (point[1] - lon) * 111_320 * math.cos(math.radians(lat))
    return math.hypot(dx, dy) <= radius


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--center", default=f"{DEFAULT_CENTER[0]},{DEFAULT_CENTER[1]}", help="lat,lon (default Sheffield city centre)")
    parser.add_argument("--radius", type=int, default=DEFAULT_RADIUS_M, help="radius in metres (default 3500)")
    parser.add_argument("--places-radius", type=int, default=None, help="radius for place labels (default 2 × radius)")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"))
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="Overpass API interpreter URL")
    parser.add_argument("--digits", type=int, default=6, help="coordinate decimal places (default 6)")
    parser.add_argument("--source", choices=("overpass", "openfreemap"), default="overpass",
                        help="overpass (raw OSM tags, default) or openfreemap (decode OpenMapTiles vector tiles)")
    parser.add_argument("--tiles", type=int, default=4, help="split buildings/roads into an N × N grid of smaller queries (default 4)")
    parser.add_argument("--pause", type=float, default=2.0, help="seconds to wait between Overpass requests (default 2)")
    args = parser.parse_args()

    lat, lon = (float(part) for part in args.center.split(","))
    place_around = f"(around:{args.places_radius or args.radius * 2},{lat},{lon})"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    roads_regex = "|".join(ROAD_CLASSES)
    places_regex = "|".join(PLACE_CLASSES)

    if args.source == "openfreemap":
        places_radius = args.places_radius or args.radius * 2
        print(f"Decoding OpenFreeMap vector tiles within {places_radius} m of {lat},{lon} ...")
        b, r, p = fetch_openfreemap(lat, lon, args.radius, places_radius, args.digits, args.pause / 4)
        for name, features, label, radius in (("buildings", b, "OpenStreetMap buildings via OpenFreeMap, central Sheffield", args.radius),
                                              ("roads", r, "OpenStreetMap roads via OpenFreeMap, central Sheffield", args.radius),
                                              ("places", p, "OpenStreetMap place names via OpenFreeMap, Sheffield", places_radius)):
            write(out / f"sheffield-{name}.geojson", features, label, (lat, lon), radius, OFM_ATTRIBUTION, "openfreemap-openmaptiles")
        print("Done. Attribution: " + OFM_ATTRIBUTION)
        return

    print(f"Fetching buildings within {args.radius} m of {lat},{lon} ...")
    data = tiled('[out:json][timeout:180];(way["building"]({bbox});relation["building"]["type"="multipolygon"]({bbox}););out geom;', lat, lon, args.radius, args.tiles, args.endpoint, args.pause)
    data = {"elements": [e for e in data["elements"] if within(e, lat, lon, args.radius)]}
    write(out / "sheffield-buildings.geojson", buildings(data, args.digits), "OpenStreetMap buildings, central Sheffield", (lat, lon), args.radius)

    print("Fetching roads ...")
    data = tiled(f'[out:json][timeout:180];way["highway"~"^({roads_regex})$"]({{bbox}});out geom;', lat, lon, args.radius, args.tiles, args.endpoint, args.pause)
    data = {"elements": [e for e in data["elements"] if within(e, lat, lon, args.radius)]}
    write(out / "sheffield-roads.geojson", roads(data, args.digits), "OpenStreetMap roads, central Sheffield", (lat, lon), args.radius)

    print("Fetching place labels ...")
    data = overpass(f'[out:json][timeout:120];node["place"~"^({places_regex})$"]{place_around};out;', args.endpoint)
    write(out / "sheffield-places.geojson", places(data, args.digits), "OpenStreetMap place names, Sheffield", (lat, lon), args.places_radius or args.radius * 2)
    print("Done. Attribution: " + ATTRIBUTION)


if __name__ == "__main__":
    main()
