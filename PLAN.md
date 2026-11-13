# HomeShield execution plan

## Goal

Show that a local multimodal AI workflow can interpret a resident report, apply configurable Awaab's Law deadlines, obtain human approval, and re-plan repair workers after an emergency while keeping sensitive data on the DGX Spark.

## Scope and cut lines

### Must

- Mock-first report -> validated case -> deadlines -> approval -> schedule -> live dashboard.
- Configurable YAML rules, traceable agent events, SSE updates, offline local geometry.
- Emergency re-plan with measured solver time and an OR-Tools/mock fallback.
- Awaab's Law and privacy claims labelled `VERIFY:` until checked against official guidance.

### Should

- Shared Nano Omni/Ollama endpoint, NemoClaw integration, cuOpt, voice transcription.
- 300-500 synthetic properties, Sheffield roads, worker animation.

### Could

- OSM building footprints, NemoGuard PII, online basemap, extra hazard categories.

**14:00 cut:** drop building footprints, voice, and any nonessential animations. **15:30 cut:** use mock intake, mock scheduler, and recorded demo; keep the end-to-end path polished.

## Ownership and integration

| Producer | Output | Consumer |
|---|---|---|
| Person 1 | configured LLM/NemoClaw endpoint | Persons 2 and 3 |
| Person 2 | `analyse_report()` -> `Case` | Person 3 |
| Person 3 | REST API, rules, events, approvals | Person 5 and all |
| Person 4 | `Scheduler` -> `Plan`, GeoJSON | Person 3 and 5 |
| Person 5 | dashboard and pitch | judges |

## Gates

- 10:45: all five mocks run locally; Spark smoke test passes.
- 13:00: report -> case -> deadlines -> schedule -> map works.
- 15:00: local model and cuOpt or fallback work; emergency re-plan is visible.
- 16:00: feature freeze and backup video captured.
- 17:30: three timed rehearsals.

## Risk register

| Risk | Early sign | Fallback | Owner |
|---|---|---|---|
| cuOpt fails on Arm | install/import error | OR-Tools, then mock | Person 4 |
| Omni too slow/large | timeout or memory pressure | text/photo mock or hosted profile | Person 1/2 |
| Ollama lacks vision/tool calls | endpoint rejects payload | hosted model or mock | Person 1 |
| no local speech-to-text | audio cannot transcribe | text + photo | Person 2 |
| map fails offline | blank map/network requests | local sample GeoJSON | Person 5 |
| Wi-Fi blocks downloads | pull stalls | preloaded model/mock | Person 1 |
| empty reasoning replies | `content=null` | `max_tokens>=2048`, fallback | Person 1/3 |
| Spark unreachable | SSH/tunnel fails | hosted API/mock | Person 1 |
| stage demo fails | UI/API error | recorded video and seeded fixtures | Person 5 |

## Timeline by role

| Time | 1 Spark | 2 Intake | 3 Backend | 4 Scheduling | 5 Frontend |
|---|---|---|---|---|---|
| 10:00-10:45 | access, inventory | mock case | API skeleton | mock plan/data | Vite shell |
| 10:45-13:00 | endpoint | real/mock adapter | wire flow | fallback solver | twin + SSE |
| 13:00-15:00 | NemoClaw checkpoint | model tests | approvals/events | cuOpt test | emergency animation |
| 15:00-16:00 | stabilise | errors | integration | benchmark | feature freeze |
| 16:00-20:00 | monitor | support | demo support | support | pitch/rehearse |

## First 15 minutes

Each person follows their own role checklist. The team must not wait for real models: use `USE_MOCKS=true`, commit interfaces first, and integrate at the 13:00 gate.
