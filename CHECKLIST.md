# Master checklist

| Role | Items | Done | % | Status |
|---|---:|---:|---:|---|
| Person 1 | 8 | 0 | 0% | not started |
| Person 2 | 7 | 0 | 0% | not started |
| Person 3 | 9 | 0 | 0% | not started |
| Person 4 | 8 | 6 | 75% | in progress |
| Person 5 | 9 | 0 | 0% | not started |

## Person 1 — Spark, models and NemoClaw

- [x] **[Person 1 | 10:00-10:15]** Get Spark access; done when SSH or NVIDIA Sync terminal works.
- [x] **[Person 1 | 10:15-10:25]** Check GPU, memory and Docker; done when `smoke_test.sh` passes.
- [x] **[Person 1 | 10:25-10:35]** Set up GitHub deployment access and remote connections; done when the repo is reachable.
- [ ] **[Person 1 | 10:35-10:45]** Check installed Ollama models; done when exact names are recorded privately in `.env`.
- [ ] **[Person 1 | 10:45-11:30]** Start Nano Omni or the best available vision model; done when Person 2 can call it.
- [ ] **[Person 1 | 11:30-12:15]** Install/configure NemoClaw with OpenShell; done when one approved tool call succeeds.
- [ ] **[Person 1 | 12:15 checkpoint]** If NemoClaw is not working after 45 minutes, switch to Python fallback; done when fallback is available.
- [ ] **[Person 1 | 13:00 onward]** Keep servers running and prepare hosted fallback; done when the team can demo offline and hosted profiles.

## Person 2 — Multimodal intake

- [ ] **[Person 2 | 10:00-10:30]** Create `analyse_report()` accepting text/photo/audio; done when the mock returns a valid Case.
- [ ] **[Person 2 | 10:30-11:15]** Connect shared Nano Omni API; done when one real request is parsed.
- [ ] **[Person 2 | 11:15-11:45]** Validate structured JSON and null missing details; done when invalid output produces a clear error.
- [ ] **[Person 2 | 11:45-12:15]** Test mould, leak and electrical reports; done when all three fixtures pass.
- [ ] **[Person 2 | 12:15-12:45]** Add text-only fallback and helpful request errors; done when it works with `USE_MOCKS=true`.
- [ ] **[Person 2 | 13:00 checkpoint]** Hand function to Person 3; done when API creates a case from the adapter.
- [ ] **[Person 2 | 15:00 checkpoint]** Verify model path or freeze mock; done when demo input is reliable.

## Person 3 — Backend, compliance and orchestration

- [ ] **[Person 3 | 10:00-10:45]** Create FastAPI, SQLite and shared models; done when `/health` and `/docs` load.
- [ ] **[Person 3 | 10:45-11:30]** Implement case creation/retrieval/status; done when API tests pass.
- [ ] **[Person 3 | 11:30-12:00]** Implement deterministic YAML deadline rules; done when working-day tests pass.
- [ ] **[Person 3 | 12:00-12:30]** Require human approval for consequential actions; done when approval is pending before notify/escalate.
- [ ] **[Person 3 | 12:30-13:00]** Connect intake and scheduler interfaces; done when end-to-end mock flow works.
- [ ] **[Person 3 | 13:00 checkpoint]** Add SSE stream and simulator toggle; done when frontend receives case and plan events.
- [ ] **[Person 3 | 13:00-15:00]** Integrate NemoClaw/fallback and activity log; done when trace shows tool calls/results.
- [ ] **[Person 3 | 15:00 checkpoint]** Add emergency endpoint and re-plan; done when urgent case changes Plan.
- [ ] **[Person 3 | 16:00]** Feature freeze; done when backup API fixture is seeded.

## Person 4 — cuOpt, scheduling and map data

- [x] **[Person 4 | 10:00-10:30]** Create 8 workers and 30 jobs; done when deterministic fixtures load.
- [x] **[Person 4 | 10:30-11:00]** Generate 300-500 properties; done when local GeoJSON is rendered.
- [x] **[Person 4 | 11:00-11:30]** Export roads or labelled haversine fallback; done when `roads.geojson` exists.
- [ ] **[Person 4 | 11:30-12:30]** Install/test cuOpt on Spark; done when import status is recorded.
- [x] **[Person 4 | 12:30-13:00]** Implement `optimise_schedule()` and validation; done when mock Plan is valid.
- [ ] **[Person 4 | 13:00 checkpoint]** Integrate scheduler interface; done when backend can request a Plan.
- [x] **[Person 4 | 13:00-15:00]** Implement emergency re-optimisation and benchmark; done when solver time is shown.
- [x] **[Person 4 | 15:00 checkpoint]** Keep OR-Tools/mock fallback ready; done when a new emergency never blocks the demo.

## Person 5 — Frontend, twin and demo

- [ ] **[Person 5 | 10:00-10:45]** Create React/TypeScript frontend; done when it runs against mock API.
- [ ] **[Person 5 | 10:45-12:00]** Build resident report form and case cards; done when a report can be submitted.
- [ ] **[Person 5 | 11:00-13:00]** Build live 3D Sheffield digital twin; done when properties use shared severity colours.
- [ ] **[Person 5 | 12:00-13:00]** Add SSE feed, counters and agent trace; done when live events render.
- [ ] **[Person 5 | 13:00 checkpoint]** Add approvals queue and inject emergency; done when approval/re-plan is visible.
- [ ] **[Person 5 | 13:00-15:00]** Animate worker routes and route changes; done when old/new routes are distinguishable.
- [ ] **[Person 5 | 15:00 checkpoint]** Connect complete backend flow; done when judge path works offline.
- [ ] **[Person 5 | 16:00]** Feature freeze and record backup video; done when a video covers the full script.
- [ ] **[Person 5 | 17:30]** Rehearse pitch three times; done when demo fits five minutes.

## Shared gates

- [ ] **[All | 10:45]** All mocks run locally and Spark smoke test passes.
- [ ] **[All | 13:00]** Report -> Case -> deadlines -> schedule -> map works.
- [ ] **[All | 15:00]** Real model and cuOpt/fallback emergency re-plan work.
- [ ] **[All | 16:00]** Feature freeze, seeded data and backup video are ready.
- [ ] **[All | 17:30]** Complete three timed rehearsals.
