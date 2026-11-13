/** Typed error with a message that is safe to show to users. `status` is 0 for network failures. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError'; }
}

const FRIENDLY: Record<number, string> = {
  0: 'Cannot reach HomeShield. Check your connection and try again.',
  404: 'That item could not be found.',
  409: 'This change conflicts with the latest information. Refresh and try again.',
  413: 'That file is too large.',
  415: 'That file type is not supported.',
  422: 'Some details are missing or invalid.',
  503: 'A HomeShield service is temporarily unavailable. Try again shortly.',
};

/** Relative `/api` URLs only: the dev proxy (or production reverse proxy) forwards them to FastAPI. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Never set Content-Type for FormData: the browser must add the multipart boundary itself.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, headers }); }
  catch { throw new ApiError(FRIENDLY[0]!, 0); }
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === 'string') detail = body.detail; } catch { /* not JSON */ }
    // Backend 409/422 details are written for people (e.g. "Add a short note…"); others get a generic message.
    const safe = (response.status === 409 || response.status === 422) && detail && detail.length < 200 ? detail : FRIENDLY[response.status] ?? 'Something went wrong. Try again.';
    throw new ApiError(safe, response.status);
  }
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

export const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
