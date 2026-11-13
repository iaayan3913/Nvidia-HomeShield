# FastAPI integration

> **Superseded (round 2).** The separate `ApiHomeShieldService` described below has been replaced by the shared contract data service in `src/shared/mock` (HTTP + SSE through the `/api` dev proxy). `src/shared/data` remains as a thin compatibility layer over it. Use `VITE_DATA_MODE` / `VITE_BACKEND_URL` (not `VITE_DATA_SOURCE` / `VITE_API_URL`) and see the root README section "Run HomeShield on two devices".

HomeShield has two explicit, isolated data sources. `mock` is the default and runs the complete fictional demonstration without FastAPI, network access, or NVIDIA services. `api` reads and writes the configured FastAPI service. Live failures never cause mock records to be mixed into an API session.

## Run locally

Install once, then start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

For the stable offline demo, create `frontend/.env.local`:

```env
VITE_DATA_SOURCE=mock
VITE_API_URL=http://127.0.0.1:18100
```

For FastAPI mode, change only the first value:

```env
VITE_DATA_SOURCE=api
VITE_API_URL=http://127.0.0.1:18100
```

Restart Vite after changing an environment variable. API mode displays its connection state, offers **Retry**, and provides an explicit **Use demo** action. The mode choice is stored as `homeshield.data-source.override`; remove that local-storage item to return to the environment default.

## Connect to a DGX Spark

The browser talks only to HomeShield FastAPI. It never calls Nano Omni, Ollama, or NVIDIA APIs directly. With FastAPI listening on Spark port 8100, create a tunnel from the laptop:

```powershell
ssh -N -L 18100:127.0.0.1:8100 user@<SPARK_IP>
```

Then use `VITE_API_URL=http://127.0.0.1:18100`. Do not place model credentials or backend secrets in any `VITE_` variable. FastAPI's existing restricted CORS configuration must allow the actual Vite origin (normally `http://127.0.0.1:5173` or `http://localhost:5173`); this integration does not broaden it.

## Backend endpoints used

| Purpose | Endpoint |
| --- | --- |
| Connection check | `GET /health` |
| Cases and workers | `GET /api/cases`, `GET /api/workers` |
| Proposed and active schedules | `GET /api/plans/latest`, `GET /api/plans/active`, `GET /api/plans/{id}` |
| Approvals | `GET /api/approvals`, `POST /api/approvals/{id}/approve`, `POST /api/approvals/{id}/reject` |
| Resident intake | `POST /api/reports` (JSON or multipart) |
| Scheduling request | `POST /api/agent/tools/schedule_job` |
| Fictional emergency | `POST /api/emergency` |
| Activity fallback | `GET /api/events?after=0&limit=1000` |
| Live activity | `GET /api/stream` |

Multipart intake sends `text`, `property_id`, one `photo`, and one `audio` without manually setting `Content-Type`. The resident UI can retain more than one photo for the mock demonstration; API mode tells the user when additional photos were not uploaded. Backend `warnings` and HTTP validation errors are shown rather than converted into success.

## Live updates

There is one application-level `EventSource`. It registers named listeners for:

`case.created`, `case.status_changed`, `plan.proposed`, `plan.updated`, `plan.approved`, `plan.rejected`, `plan.activated`, `plan.replan_started`, `plan.replan_completed`, `plan.conflicts`, `plan.failed`, `approval.requested`, `approval.approved`, `approval.rejected`, `agent.action_result`, and `job.progress`.

Events are deduplicated by SSE ID (or payload ID) and trigger a consistent state refresh. When SSE fails, the client uses a non-overlapping two-second polling loop and periodically attempts to restore the stream. Unmounting the application closes the stream and polling timer.

## Data and workflow rules

- Local Sheffield geographic fixtures remain the truthful map background and stable property-ID lookup. They are labelled synthetic; straight waypoint links are not presented as road navigation.
- `/api/plans/latest` is a proposal only when it is not approved. Operative assignments and active routes come only from `/api/plans/active`.
- Solver labels come directly from the plan (`cuopt`, `ortools`, `mock`, or another backend value).
- Approval controls use the pending approval record associated with the plan. A failed approval leaves the previous active plan visible.
- Emergency responses may contain a stored case and no plan. That state is displayed as a scheduling failure and is never presented as a generated route.
- Resident contact and access fields are retained by the mock workflow, but the current report API does not accept or persist them. API confirmation states this limitation.

## Missing backend contracts and limitations

- There is no properties API, so the map uses the repository's synthetic `sample-properties.json` and joins cases by `property_id`.
- There are no operative journey, arrival, work-start, completion, inability-to-complete, or operative-evidence endpoints. In API mode those controls are explicitly labelled local-only and are lost on refresh; mock mode retains the full shared workflow.
- The backend does not provide live worker GPS. Worker coordinates are displayed as backend-provided base/current coordinates without claiming device tracking.
- The report contract accepts one photo and one audio file. Additional resident evidence is not uploaded.
- Contact details are not sent because the backend schema has no corresponding fields.
- SSE resumption is protected by event-ID deduplication and the events refresh endpoint; the current stream contract does not expose a client-configurable resume cursor.

## Verification and smoke test

Frontend checks:

```powershell
cd frontend
npm test
npm run build
```

Basic live API checks through the tunnel:

```powershell
Invoke-RestMethod http://127.0.0.1:18100/health
Invoke-RestMethod http://127.0.0.1:18100/api/cases
Invoke-RestMethod http://127.0.0.1:18100/api/workers
Invoke-RestMethod http://127.0.0.1:18100/api/plans/active
Invoke-RestMethod http://127.0.0.1:18100/api/events?after=0`&limit=20
```

Submit a harmless fictional report only to an isolated demo database:

```powershell
$body = @{ text = 'Fictional smoke test: damp patch by bedroom window'; property_id = 'p-001' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18100/api/reports -ContentType 'application/json' -Body $body
```

Open the Operations portal and verify the returned case reference and `p-001` highlight. Review, rather than automatically approve, any generated proposal. Exercise the emergency endpoint only on a disposable demo database because it creates a persisted case and may invoke scheduling.

To recover the hackathon demo at any time, select **Use demo**, or set `VITE_DATA_SOURCE=mock`, clear the override, and restart Vite. Mock mode requires no backend process.
