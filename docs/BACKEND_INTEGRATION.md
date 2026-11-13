# Backend integration

The backend is the authoritative owner of cases, deadlines, approvals, plans and audit events.
Run it from the repository root with `py -3.13 -m uvicorn backend.app:app --reload --port 8001` on the
current demo laptop (`py` without a version currently selects a missing 3.14 installation).

## Model endpoints and ports

- Nano Omni intake: Spark port `8000`, configured with `LLM_BASE_URL`, `LLM_API_KEY`, and
  `INTAKE_MODEL`. From a laptop, prefer `ssh -L 18000:localhost:8000 user@<spark-ip>` and set
  `LLM_BASE_URL=http://127.0.0.1:18000/v1`.
- Nemotron Lightning Python agent: Ollama port `11434`, configured independently with
  `AGENT_BASE_URL`, `AGENT_API_KEY`, and `AGENT_MODEL`. Tunnel with
  `ssh -L 11434:localhost:11434 user@<spark-ip>` when required.
- HomeShield FastAPI: port `8001`; set the frontend to `VITE_API_URL=http://127.0.0.1:8001`.
- NemoClaw remains independent and uses only `NEMOCLAW_URL` in this backend.

If FastAPI runs on the Spark, bind it to `8001`; never bind it to Nano Omni's `8000`. A laptop can
forward both model ports in one SSH command while leaving local 8001 for its own FastAPI process.

## Person 1: NemoClaw/runtime

- Configure `NEMOCLAW_URL` and `AGENT_RUNTIME=nemoclaw`.
- Register the OpenAI-compatible declarations returned by `GET /api/agent/tools` in the actual
  NemoClaw runtime; exposing schemas alone does not register them.
- Permit the runtime to call `POST /api/agent/tools/{tool_name}` with a JSON arguments object.
- The tested fallback is `AGENT_RUNTIME=mock`; `NemoClawAgent` is an untested HTTP seam until the
  runtime contract and sandbox permissions are supplied.
- For the Python fallback use `AGENT_RUNTIME=python`; it calls the Lightning endpoint for a bounded
  JSON tool selection and never exposes model reasoning. `AGENT_RUNTIME=mock` stays fully offline.

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

- Person 4's solver core is integrated. Select `SCHEDULER_ADAPTER=mock`, `ortools`, `cuopt`, or
  `auto`; set `SCHEDULER_TIME_LIMIT_S` for solver limits and `SCHEDULER_SEED_JOBS=true` to include
  the 8-worker/36-job offline fixture. Explicit adapters still end in the labelled mock fallback.
- Inputs are validated `Worker` and `Job` objects. Case-to-job conversion uses the property stock,
  required skill, duration, compliance/appointment window and priority. Outputs are shared `Plan`
  objects with measured `solver_ms`, ordered stops/ETAs/coordinates/slack, unassigned jobs and
  conflicts. `GET /api/workers` supplies worker start coordinates and skills.
- `SCHEDULER_CLOCK=demo` uses `SCHEDULER_DEMO_START` on the fixture day; use `real` to rebase worker
  shifts to today. Travel is labelled precomputed data when present, otherwise the labelled
  haversine fallback.
- Every plan is persisted first as `approved=false`. `GET /api/plans/latest` returns the newest
  proposal; `/api/plans/active` returns only the newest approved plan. An emergency warm-starts
  from that active plan and current worker positions. Approval emits `plan.approved` and
  `plan.activated`; rejection leaves the prior active plan unchanged.
- OR-Tools 9.15 is tested on Windows. cuOpt remains an availability-checked adapter and must be
  verified on DGX Spark with `python3 -m scheduler.cuopt`; no local cuOpt execution is claimed.

## Person 5: frontend

- REST: `/api/reports`, `/api/cases`, `/api/plans/latest`, `/api/approvals`, and `/api/emergency`.
- Scheduling REST: `/api/plans/latest` (proposal), `/api/plans/active`, `/api/plans/{id}`, and
  `/api/workers`. Ordered stop coordinates are the route waypoints; no road geometry is fabricated.
- Keep JSON text reports unchanged. For media, send `multipart/form-data` with `text`, optional
  `property_id`, and optional `photo`/`audio` file parts. Do not manually set the multipart
  `Content-Type` boundary and do not construct `upload://` references.
- Allowed photos are validated JPEG, PNG, or WebP. Allowed audio is WAV, MP3, Ogg, M4A, WebM,
  or FLAC. Default limits are 10 MiB for photos and 25 MiB for audio.
- SSE: connect to `/api/stream`; listen for named events (not only `onmessage`). Reconnect with the
  browser-managed `Last-Event-ID`. Events contain safe summaries, not raw reports.
- Scheduling events are `plan.proposed`, `plan.replan_started`, `plan.replan_completed`,
  `plan.conflicts`, `plan.failed`, `plan.approved`, `plan.rejected`, and `plan.activated`. Proposal
  events include the Plan plus `moved`/`added`/`dropped` route changes for map animation.
- Approval decisions use `POST /api/approvals/{id}/approve` or `/reject` with
  `{"decided_by":"officer-id","reason":"optional"}`.

SSE is deliberately SQLite-polled and single-process-demo oriented. Multiple clients and replay
work in one process, but production multi-worker fan-out needs a shared broker such as Redis.

Uploads are private files under `UPLOAD_DIRECTORY` (default `data/uploads/`) and are never mounted
as a public static directory. SQLite stores only the opaque reference, MIME type/size description,
and processing status.
