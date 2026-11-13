# Person 3 — Backend, compliance and orchestration

## Goal and ownership

Own FastAPI, SQLite, rules, approvals, agent events, SSE, and integration. Do not own model deployment, routing algorithms, or React components.

## Start

```powershell
py -m uvicorn backend.app:app --reload --port 8001
Invoke-RestMethod http://127.0.0.1:8001/health
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/api/reports -ContentType 'application/json' -Body '{"text":"Gas smell in kitchen","property_id":"p-001"}'
```

Use `USE_MOCKS=true` first. Add real intake and scheduler by changing configuration only. Keep approval before notification/escalation and emit every event to SSE.

## Checkpoints

- 10:45: `/health`, docs, case CRUD, and working-day tests pass.
- 13:00: complete mock flow reaches the frontend.
- 15:00: emergency endpoint changes a Plan and trace shows tool calls.
- Done: seeded fallback works offline and no PII enters logs.

## Checklist

- [X] `/health`, OpenAPI docs, and case CRUD work.
- [X] YAML deadline rules and working-day tests pass.
- [X] Approval is required before consequential actions.
- [X] Intake and scheduler are connected behind stable interfaces.
- [X] SSE emits case, plan, and agent events.
- [X] Emergency re-plan and offline seed data work.
