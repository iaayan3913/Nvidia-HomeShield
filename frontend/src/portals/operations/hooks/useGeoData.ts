import { useCallback, useEffect, useState } from 'react';
import { GeoDataError, parseRoads, parseStock, type ParsedCollection, type RoadFeature, type StockUnit } from '../lib/geo';

export const ROADS_URL = '/roads-major.geojson';
export const STOCK_URL = '/properties.geojson';

export interface GeoData { roads: ParsedCollection<RoadFeature>; stock: ParsedCollection<StockUnit>; }
export type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; data: GeoData }
  | { status: 'error'; kind: GeoDataError['kind']; message: string };

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { signal, cache: 'force-cache' }); }
  catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new GeoDataError(offline ? 'This device is offline and the local map files could not be read from cache.' : `Could not load ${url}.`, offline ? 'offline' : 'network');
  }
  if (!response.ok) throw new GeoDataError(`${url} returned ${response.status}.`, 'http');
  try { return await response.json(); }
  catch { throw new GeoDataError(`${url} is not valid JSON.`, 'malformed'); }
}

/** Loads the committed local datasets only; the twin never depends on a remote service. */
export function useGeoData() {
  const [state, setState] = useState<GeoState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    Promise.all([fetchJson(ROADS_URL, controller.signal), fetchJson(STOCK_URL, controller.signal)])
      .then(([roads, stock]) => {
        const data = { roads: parseRoads(roads), stock: parseStock(stock) };
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error as Error).name === 'AbortError') return;
        const kind = error instanceof GeoDataError ? error.kind : 'malformed';
        setState({ status: 'error', kind, message: error instanceof Error ? error.message : 'Map data could not be read.' });
      });
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}
