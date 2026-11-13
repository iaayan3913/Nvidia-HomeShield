/**
 * Zoom-aware labels so text never piles up when zooming out (workstream B).
 *
 * Two parts:
 *  1. The dashboard's own `neighbourhoods` deck.gl TextLayer (16 names with a `major` flag):
 *     `neighbourhoodLabelStyle(zoom, label)` gives visibility, size and opacity per zoom.
 *  2. Any MapLibre basemap symbol layers (street, place, POI names from the vector tiles):
 *     `applyBasemapLabelRules(map)` sets min zooms, fade-in opacity and no overlap.
 */

export interface NeighbourhoodLabel {
  name: string;
  major?: boolean;
}

export interface LabelStyle {
  visible: boolean;
  sizePx: number;
  /** 0..1 multiplier for the label colour's alpha. */
  alpha: number;
}

/** Zoom thresholds (MapLibre zoom levels). The demo camera opens at zoom 14. */
export const LABEL_ZOOMS = {
  /** Minor neighbourhood names fade in between these zooms. */
  minorFadeStart: 12.5,
  minorFull: 13.25,
  /** Below this, major names shrink; below `majorHidden` they disappear. */
  majorShrink: 11.5,
  majorHidden: 10,
} as const;

function ramp(zoom: number, from: number, to: number): number {
  if (zoom <= from) return 0;
  if (zoom >= to) return 1;
  return (zoom - from) / (to - from);
}

export function neighbourhoodLabelStyle(zoom: number, label: NeighbourhoodLabel): LabelStyle {
  if (label.major) {
    const alpha = ramp(zoom, LABEL_ZOOMS.majorHidden, LABEL_ZOOMS.majorHidden + 0.75);
    const sizePx = zoom >= LABEL_ZOOMS.majorShrink ? 12 : 10;
    return { visible: alpha > 0, sizePx, alpha };
  }
  const alpha = 0.75 * ramp(zoom, LABEL_ZOOMS.minorFadeStart, LABEL_ZOOMS.minorFull);
  return { visible: alpha > 0, sizePx: 10.5, alpha };
}

/**
 * Round the zoom for deck.gl `updateTriggers` so accessors re-run a few times
 * per zoom level, not on every frame.
 */
export function zoomBucket(zoom: number): number {
  return Math.round(zoom * 4) / 4;
}

// ---- MapLibre basemap labels -------------------------------------------------

/** Minimal slice of maplibre-gl's Map used here, so this module has no MapLibre dependency. */
export interface MapLike {
  getStyle(): { layers?: { id: string; type: string; "source-layer"?: string; minzoom?: number; maxzoom?: number }[] } | undefined;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setLayerZoomRange(layerId: string, minzoom: number, maxzoom: number): void;
}

/**
 * Minimum zoom for a basemap symbol layer, from its OpenMapTiles source-layer / id
 * (the schema OpenFreeMap uses). Returns null for layers that should be left alone.
 */
export function basemapLabelMinZoom(layer: { id: string; "source-layer"?: string }): number | null {
  const src = layer["source-layer"] ?? "";
  const id = layer.id.toLowerCase();
  if (src === "transportation_name" || /road|street|highway|shield/.test(id)) return 15;
  if (src === "poi" || /poi|amenity/.test(id)) return 16.5;
  if (src === "water_name" || /water/.test(id)) return 13;
  if (src === "place" || /place|city|town|village|suburb|neighbourhood/.test(id)) {
    if (/city|town/.test(id)) return 9;
    if (/village|suburb/.test(id)) return 12.5;
    return 14; // neighbourhood, hamlet and similar: the dashboard draws its own area names
  }
  if (src === "housenumber" || /housenumber/.test(id)) return 17.5;
  return null;
}

/** Apply min zooms, fade-in opacity and collision rules to every basemap symbol layer. Returns ids changed. */
export function applyBasemapLabelRules(map: MapLike): string[] {
  const changed: string[] = [];
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "symbol") continue;
    const minzoom = basemapLabelMinZoom(layer);
    if (minzoom === null) continue;
    const min = Math.max(minzoom, layer.minzoom ?? 0);
    map.setLayerZoomRange(layer.id, min, layer.maxzoom ?? 24);
    map.setLayoutProperty(layer.id, "text-allow-overlap", false);
    map.setLayoutProperty(layer.id, "text-ignore-placement", false);
    map.setLayoutProperty(layer.id, "text-optional", true);
    map.setPaintProperty(layer.id, "text-opacity", ["interpolate", ["linear"], ["zoom"], min, 0, min + 0.6, 1]);
    changed.push(layer.id);
  }
  return changed;
}
