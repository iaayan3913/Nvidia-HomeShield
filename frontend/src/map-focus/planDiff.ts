/**
 * Which worker routes changed between two plans (workstream B).
 *
 * Framework-free so it works with both the backend Plan (live mode) and the
 * dashboard's mock plans: adapt either into a RouteMap first.
 */

/** worker id -> ordered stop ids (job ids in the backend plan, case ids in mock data). */
export type RouteMap = Record<string, string[]>;

/** Backend Plan shape from docs/CONTRACTS.md (extra fields are ignored). */
export interface BackendStop {
  job_id: string;
  eta: string;
  lat: number;
  lon: number;
  slack_minutes?: number | null;
}
export interface BackendWorkerPlan {
  worker_id: string;
  stops: BackendStop[];
}
export interface BackendPlan {
  id: string;
  solver: string;
  solver_ms: number;
  workers: BackendWorkerPlan[];
  unassigned_jobs?: string[];
  conflicts?: string[];
  approved?: boolean;
}

export interface RouteDiff {
  /** Workers whose ordered stop list differs in any way (gained, lost or reordered stops). */
  changedWorkers: string[];
  /** Stops that moved from one worker to another. */
  moved: { stopId: string; from: string; to: string }[];
  /** Stops that are new in `next` (for example the emergency job). */
  added: { stopId: string; to: string }[];
  /** Stops that are no longer assigned in `next`. */
  removed: { stopId: string; from: string }[];
}

export function routesFromPlan(plan: BackendPlan | null | undefined): RouteMap {
  const routes: RouteMap = {};
  for (const worker of plan?.workers ?? []) routes[worker.worker_id] = worker.stops.map((s) => s.job_id);
  return routes;
}

function owners(routes: RouteMap): Map<string, string> {
  const result = new Map<string, string>();
  for (const [workerId, stops] of Object.entries(routes)) for (const stop of stops) result.set(stop, workerId);
  return result;
}

function sameOrder(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((stop, i) => stop === b[i]);
}

/** Compare two route maps. With no previous plan, every worker with stops counts as changed. */
export function diffRoutes(prev: RouteMap | null | undefined, next: RouteMap): RouteDiff {
  const before = owners(prev ?? {});
  const after = owners(next);
  const moved: RouteDiff["moved"] = [];
  const added: RouteDiff["added"] = [];
  const removed: RouteDiff["removed"] = [];
  for (const [stopId, to] of after) {
    const from = before.get(stopId);
    if (from === undefined) added.push({ stopId, to });
    else if (from !== to) moved.push({ stopId, from, to });
  }
  for (const [stopId, from] of before) if (!after.has(stopId)) removed.push({ stopId, from });

  const workerIds = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  const changedWorkers = [...workerIds]
    .filter((id) => !sameOrder(prev?.[id], next[id]) && ((prev?.[id]?.length ?? 0) > 0 || (next[id]?.length ?? 0) > 0))
    .sort();
  return { changedWorkers, moved, added, removed };
}
