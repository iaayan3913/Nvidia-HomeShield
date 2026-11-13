import { useEffect, useState } from 'react';
import { GeoDataError, parseCollection, type LocalCollection } from '../lib/geo';

export const LOCAL_DATA_URLS = {
  buildings: '/data/sheffield-buildings.geojson',
  roads: '/data/sheffield-roads.geojson',
  places: '/data/sheffield-places.geojson',
} as const;

export interface LocalMapData { buildings: LocalCollection | null; roads: LocalCollection | null; places: LocalCollection | null; }
export type LocalDataState =
  | { status: 'loading' }
  | { status: 'ready'; data: LocalMapData; missing: Array<keyof LocalMapData>; errors: string[] };

const GEOMETRY: Record<keyof LocalMapData, string[]> = { buildings: ['Polygon', 'MultiPolygon'], roads: ['LineString', 'MultiLineString'], places: ['Point'] };

async function load(key: keyof LocalMapData, signal: AbortSignal): Promise<LocalCollection | null> {
  let response: Response;
  try { response = await fetch(LOCAL_DATA_URLS[key], { signal }); }
  catch (error) { if ((error as Error).name === 'AbortError') throw error; throw new GeoDataError(`Could not read ${LOCAL_DATA_URLS[key]}.`, 'network'); }
  if (!response.ok) return null;
  const raw = await response.text();
  // Vite's SPA fallback answers missing files with index.html, so HTML means "not present".
  if (raw.trimStart().startsWith('<')) return null;
  try { return parseCollection(JSON.parse(raw), `Local ${key}`, GEOMETRY[key]); }
  catch (error) { throw error instanceof GeoDataError ? error : new GeoDataError(`${LOCAL_DATA_URLS[key]} is not valid JSON.`, 'malformed'); }
}

/** Optional local Sheffield data from scripts/fetch-sheffield.py. Missing files are normal, not an error. */
export function useLocalMapData(): LocalDataState {
  const [state, setState] = useState<LocalDataState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const keys = Object.keys(LOCAL_DATA_URLS) as Array<keyof LocalMapData>;
    Promise.all(keys.map((key) => load(key, controller.signal).then((value) => ({ key, value, error: null as string | null }), (error: Error) => ({ key, value: null, error: error.name === 'AbortError' ? null : error.message }))))
      .then((results) => {
        if (controller.signal.aborted) return;
        const data: LocalMapData = { buildings: null, roads: null, places: null };
        results.forEach(({ key, value }) => { data[key] = value; });
        setState({ status: 'ready', data, missing: results.filter((r) => !r.value && !r.error).map((r) => r.key), errors: results.flatMap((r) => (r.error ? [r.error] : [])) });
      });
    return () => controller.abort();
  }, []);
  return state;
}
