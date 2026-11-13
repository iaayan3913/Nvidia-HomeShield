/**
 * "Routes on demand" rules for the twin map (workstream B).
 *
 * The map draws no full routes by default. This module decides, for the
 * current interaction state, which worker routes are drawn and how. TwinMap
 * turns the result into deck.gl PathLayer / TripsLayer props.
 *
 * Priority: selected > re-plan animation > hover preview > "show all".
 */

export type RouteMode = "focus" | "preview" | "all" | "dimmed" | "replan-old" | "replan-new";

export interface ReplanAnimation {
  changedWorkers: string[];
  /** ms timestamp (performance.now() or Date.now(), but be consistent with `now`). */
  startedAt: number;
  durationMs?: number;
}

export interface FocusState {
  hoveredWorker?: string | null;
  selectedWorker?: string | null;
  showAll?: boolean;
  replan?: ReplanAnimation | null;
  now: number;
}

export interface RouteRender {
  workerId: string;
  /** Which plan's geometry to draw: the previous plan (old) or the current one. */
  plan: "current" | "previous";
  mode: RouteMode;
  opacity: number;
  widthPx: number;
  dashed: boolean;
  /** Draw as an animated TripsLayer instead of a static PathLayer. */
  animate: boolean;
}

export const REPLAN_ANIMATION_MS = 5000;

/** 0..1 progress of the re-plan animation, or null when it is not running. */
export function replanProgress(replan: ReplanAnimation | null | undefined, now: number): number | null {
  if (!replan) return null;
  const duration = replan.durationMs ?? REPLAN_ANIMATION_MS;
  const t = (now - replan.startedAt) / duration;
  return t >= 0 && t < 1 ? t : null;
}

const STYLE: Record<RouteMode, Omit<RouteRender, "workerId" | "plan" | "mode">> = {
  focus: { opacity: 1, widthPx: 4, dashed: false, animate: false },
  preview: { opacity: 0.45, widthPx: 2.5, dashed: false, animate: false },
  all: { opacity: 0.35, widthPx: 2, dashed: false, animate: false },
  dimmed: { opacity: 0.1, widthPx: 1.5, dashed: false, animate: false },
  "replan-old": { opacity: 0.6, widthPx: 2, dashed: true, animate: false },
  "replan-new": { opacity: 1, widthPx: 3.5, dashed: false, animate: true },
};

function render(workerId: string, mode: RouteMode, plan: RouteRender["plan"] = "current", opacityScale = 1): RouteRender {
  const style = STYLE[mode];
  return { workerId, plan, mode, ...style, opacity: style.opacity * opacityScale };
}

/** Routes to draw (hidden routes are simply absent). Old re-plan routes fade out over the animation. */
export function routeRenders(workerIds: string[], state: FocusState): RouteRender[] {
  const progress = replanProgress(state.replan, state.now);
  const changed = new Set(progress === null ? [] : state.replan!.changedWorkers);
  const out: RouteRender[] = [];
  for (const id of workerIds) {
    if (id === state.selectedWorker) {
      out.push(render(id, "focus"));
    } else if (changed.has(id)) {
      out.push(render(id, "replan-old", "previous", 1 - progress!));
      out.push(render(id, "replan-new"));
    } else if (id === state.hoveredWorker) {
      out.push(render(id, "preview"));
    } else if (state.showAll) {
      out.push(render(id, state.selectedWorker ? "dimmed" : "all"));
    }
  }
  return out;
}

/** Whether non-route map content (hazards, other teams) should be dimmed because something is focused. */
export function isFocusActive(state: FocusState): boolean {
  return Boolean(state.selectedWorker) || replanProgress(state.replan, state.now) !== null;
}

type LonLat = [number, number];

/**
 * TripsLayer timestamps for a path, proportional to distance, spanning 0..durationMs.
 * Use with `currentTime = now - replan.startedAt` and `trailLength` about 40% of the duration.
 */
export function tripTimestamps(path: LonLat[], durationMs = REPLAN_ANIMATION_MS): number[] {
  if (path.length === 0) return [];
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    const kx = Math.cos(((y1 + y2) / 2) * (Math.PI / 180));
    cumulative.push(cumulative[i - 1] + Math.hypot((x2 - x1) * kx, y2 - y1));
  }
  const total = cumulative[cumulative.length - 1];
  return cumulative.map((d) => (total > 0 ? (d / total) * durationMs : 0));
}

/** Index of the first stop whose ETA is still ahead (the worker's "next stop"), or -1 when the day is done. */
export function nextStopIndex(etas: (string | number | Date)[], now: number | Date = Date.now()): number {
  const t = typeof now === "number" ? now : now.getTime();
  return etas.findIndex((eta) => new Date(eta).getTime() >= t);
}
