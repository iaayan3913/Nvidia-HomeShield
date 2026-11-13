# HomeShield contracts

The backend is authoritative. Consumers must tolerate new enum values and ignore unknown event fields.

## Shared models

`Case` has `id`, `hazard_type`, `hhsrs_category`, `severity`, `is_emergency`, `room`, `vulnerable_occupants`, `summary`, `evidence[]`, `deadlines`, `status`, `property_id`, and `created_at`. `Evidence` has `kind`, `uri`, and `description`. `Deadlines` has optional ISO timestamps `investigate_by`, `make_safe_by`, `start_works_by`. `Worker` has `id`, `name`, `skills[]`, `shift_start`, `shift_end`, `lat`, `lon`. `Job` has `id`, `case_id`, `required_skill`, `duration_minutes`, `lat`, `lon`, `earliest`, `latest`, and `priority`. `Stop` has `job_id`, `eta`, `lat`, `lon`, and `slack_minutes`. `Plan` has `id`, `solver`, `solver_ms`, `workers[]`, `unassigned_jobs[]`. `AgentEvent` has `id`, `case_id`, `type`, `summary`, `tool_name`, `payload`, and `created_at`. `ReportIn` has `text`, optional `photo_uri`, optional `audio_uri`, and optional `property_id`.

Enums: `HazardType = damp_mould | leak | electrical | gas | fire | other`; `Severity = routine | moderate | significant | emergency`; `CaseStatus = new | investigating | awaiting_approval | scheduled | in_progress | resolved | escalated`; `Skill = general | damp_mould | plumbing | electrical | gas | fire`.

Example report:

```json
{"text":"Black mould in my child's bedroom","photo_uri":"upload://mould.jpg","property_id":"p-001"}
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | readiness |
| POST | `/api/reports` | create and process a report |
| GET | `/api/cases` | list cases |
| GET | `/api/cases/{id}` | retrieve a case |
| PATCH | `/api/cases/{id}/status` | update status |
| POST | `/api/cases/{id}/approve` | approve consequential action |
| POST | `/api/cases/{id}/emergency` | create emergency and re-plan |
| GET | `/api/plans/latest` | latest Plan |
| GET | `/api/stream` | SSE events |

`POST /api/reports` returns `{"case": Case, "plan": Plan|null}`. SSE events use `event: case.created`, `case.status_changed`, `deadline.risk_changed`, `plan.updated`, or `agent.event` and a JSON `data` payload.

## Severity colours

`emergency=#ef4444` (red/pulsing), `significant=#f97316` (orange), `moderate=#eab308` (yellow), `routine=#9ca3af` (grey), `scheduled=#3b82f6` (blue), `resolved=#22c55e` (green/fading).

## Agent tools

Each tool uses OpenAI function-calling shape:

```json
{"type":"function","function":{"name":"create_case","description":"Persist a validated case","parameters":{"type":"object","properties":{"case":{"type":"object"}},"required":["case"]}}}
```

Names and required arguments: `compute_deadlines(case_id)`, `schedule_job(case_id)`, `request_approval(case_id, action)`, `notify_resident(case_id, message)`, `escalate(case_id, reason)`. Every call emits an `agent.event` with `tool_call` and `tool_result`; reasoning is a redacted summary, never raw personal data.
