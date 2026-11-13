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
- `intake/real.py` is integrated. Select it with `INTAKE_ADAPTER=real`; `LLM_BASE_URL`,
  `LLM_API_KEY`, and `INTAKE_MODEL` configure its model client.
- The backend passes validated absolute local paths to the real adapter during inference, then
  replaces those paths with private opaque evidence references before SQLite persistence.
- Audio is stored but not submitted by default. Enable `INTAKE_AUDIO_ENABLED=true` only after
  Person 1 verifies the endpoint's `input_audio` support. A rejected audio part is retried as a
  text/photo request and visibly recorded as not analysed.
- Missing/invalid real output returns a clear request error; it never silently uses mock analysis.

## Person 4: scheduler

- Implement `Scheduler.optimise_schedule(workers, jobs) -> Plan` in the existing scheduler seam.
- Select `SCHEDULER_ADAPTER=cuopt` or `ortools`; preserve measured `solver_ms`, conflicts and
  unassigned jobs. The backend persists proposals and requires approval before commitment.
- The current cuOpt and OR-Tools files are teammate-owned placeholders; only `mock` is tested.

## Person 5: frontend

- REST: `/api/reports`, `/api/cases`, `/api/plans/latest`, `/api/approvals`, and `/api/emergency`.
- Keep JSON text reports unchanged. For media, send `multipart/form-data` with `text`, optional
  `property_id`, and optional `photo`/`audio` file parts. Do not manually set the multipart
  `Content-Type` boundary and do not construct `upload://` references.
- Allowed photos are validated JPEG, PNG, or WebP. Allowed audio is WAV, MP3, Ogg, M4A, WebM,
  or FLAC. Default limits are 10 MiB for photos and 25 MiB for audio.
- SSE: connect to `/api/stream`; listen for named events (not only `onmessage`). Reconnect with the
  browser-managed `Last-Event-ID`. Events contain safe summaries, not raw reports.
- Approval decisions use `POST /api/approvals/{id}/approve` or `/reject` with
  `{"decided_by":"officer-id","reason":"optional"}`.

SSE is deliberately SQLite-polled and single-process-demo oriented. Multiple clients and replay
work in one process, but production multi-worker fan-out needs a shared broker such as Redis.

Uploads are private files under `UPLOAD_DIRECTORY` (default `data/uploads/`) and are never mounted
as a public static directory. SQLite stores only the opaque reference, MIME type/size description,
and processing status.
