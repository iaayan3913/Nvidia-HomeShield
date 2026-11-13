import type { BackendEvent } from './mapping';

type Status = 'live' | 'connecting' | 'offline';
export interface StreamOptions {
  /** Builds the stream URL; `after` is the last sequence seen so a reconnect resumes without replaying. */
  url(after: number | null): string;
  types: readonly string[];
  after?: number | null;
  onEvent(event: BackendEvent): void;
  onStatus(status: Status): void;
  /** Called when a dropped connection comes back, so callers can refetch anything missed. */
  onReconnect?(): void;
  EventSourceImpl?: typeof EventSource;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

/** EventSource with named events and exponential-backoff reconnects that resume from the last sequence. */
export function openStream(options: StreamOptions) {
  const Impl = options.EventSourceImpl ?? EventSource;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let source: EventSource | null = null; let attempt = 0; let timer: unknown = null; let closed = false;
  let lastSequence = options.after ?? null; let dropped = false;

  const handle = (message: MessageEvent<string>) => {
    const sequence = Number(message.lastEventId);
    if (Number.isFinite(sequence) && sequence > 0) lastSequence = Math.max(lastSequence ?? 0, sequence);
    try { options.onEvent({ ...(JSON.parse(message.data) as Omit<BackendEvent, 'sequence'>), sequence: Number.isFinite(sequence) ? sequence : 0 }); }
    catch { /* ignore malformed frames; the next refetch reconciles */ }
  };
  const connect = () => {
    if (closed) return;
    options.onStatus('connecting');
    source = new Impl(options.url(lastSequence));
    source.onopen = () => { attempt = 0; options.onStatus('live'); if (dropped) { dropped = false; options.onReconnect?.(); } };
    source.onmessage = handle;
    for (const type of options.types) source.addEventListener(type, handle as EventListener);
    source.onerror = () => {
      // Close and manage reconnection ourselves so the resume point is explicit (`after=`).
      source?.close(); dropped = true;
      if (closed) return;
      options.onStatus('offline');
      timer = setTimer(connect, backoff(attempt++));
    };
  };
  connect();
  return { close() { closed = true; if (timer !== null) clearTimer(timer); source?.close(); }, get lastSequence() { return lastSequence; } };
}
