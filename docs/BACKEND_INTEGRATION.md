# Backend integration

The backend is the authoritative owner of cases, deadlines, approvals, plans and audit events.
Run it from the repository root with `py -3.13 -m uvicorn backend.app:app --reload` on the
current demo laptop (`py` without a version currently selects a missing 3.14 installation).

## Person 1: NemoClaw/runtime

- Configure `NEMOCLAW_URL` and `AGENT_RUNTIME=nemoclaw`.
- Register the OpenAI-compatible declarations returned by `GET /api/agent/tools` in the actual
  NemoClaw runtime; exposing schemas alone does not register them.
- Permit the runtime to call `POST /api/agent/tools/{tool_name}` with a JSON arguments object.
- The tested fallback is `AGENT_RUNTIME=mock`; `NemoClawAgent` is an untested HTTP seam until the
  runtime contract and sandbox permissions are supplied.

## Person 2: intake

- Keep the public signature `analyse_report(text, photo_uri, audio_uri, property_id)`.
- Add `intake/real.py` with that function and return a `backend.schemas.Case` or compatible dict.
- Select it with `INTAKE_ADAPTER=real`. Missing/invalid real output returns a clear request error;
  it never silently claims mock analysis is real.

## Person 4: scheduler

- Implement `Scheduler.optimise_schedule(workers, jobs) -> Plan` in the existing scheduler seam.
- Select `SCHEDULER_ADAPTER=cuopt` or `ortools`; preserve measured `solver_ms`, conflicts and
  unassigned jobs. The backend persists proposals and requires approval before commitment.
- The current cuOpt and OR-Tools files are teammate-owned placeholders; only `mock` is tested.

## Person 5: frontend

- REST: `/api/reports`, `/api/cases`, `/api/plans/latest`, `/api/approvals`, and `/api/emergency`.
- SSE: connect to `/api/stream`; listen for named events (not only `onmessage`). Reconnect with the
  browser-managed `Last-Event-ID`. Events contain safe summaries, not raw reports.
- Approval decisions use `POST /api/approvals/{id}/approve` or `/reject` with
  `{"decided_by":"officer-id","reason":"optional"}`.

SSE is deliberately SQLite-polled and single-process-demo oriented. Multiple clients and replay
work in one process, but production multi-worker fan-out needs a shared broker such as Redis.
