# HomeShield

## Why this matters

In December 2020, two-year-old **Awaab Ishak** died in Rochdale after prolonged exposure to black mould in his family's social housing flat. His family had repeatedly reported the damp and mould to their landlord, but it was never properly dealt with. In 2022 a coroner ruled that the mould caused the respiratory condition that killed him.

His death led to **Awaab's Law**, which requires social landlords in England to investigate and fix dangerous damp, mould and other emergency hazards within fixed time limits. Meeting those limits depends on spotting the dangerous reports quickly and getting the right person to the home fast. Today that often means busy staff working through phone calls, emails and spreadsheets.

## What HomeShield does

HomeShield turns a tenant's repair report into an approved, scheduled repair visit. A resident reports a problem from their phone. AI running on an **NVIDIA DGX Spark** reads the photo and message and suggests the hazard and urgency. A housing officer reviews the case on a live 3D map of Sheffield. **NVIDIA cuOpt** then plans which operative goes where. Nothing reaches an operative until a person approves it, and the AI and tenant data stay on the Spark.

Built for the NVIDIA Hack for Impact, 13 November 2026.

```text
 Resident (phone)          DGX Spark                                   Staff (laptop)
 ───────────────           ─────────                                   ──────────────
 Report a problem  ──▶  Nemotron 3 Nano Omni reads photo/voice/text
                        Deadline rules suggest when it must be done
                        Nemotron 3.5 Lightning coordinates the tools
                        cuOpt proposes operative routes            ──▶  Operations: review, approve
 Track the report  ◀──  live updates over SSE                      ◀──  Operative: travel, on site, done
```

## NVIDIA technology

| Technology | What it does in HomeShield |
|---|---|
| **DGX Spark** (GB10 Grace Blackwell) | Runs the models, the route optimiser and the backend on one desk-side machine, so tenants' photos and addresses never leave the building. |
| **Nemotron 3 Nano Omni** (vLLM on the Spark) | Reads a tenant's photo, voice note and message together and suggests the hazard, room and urgency. All three demo reports are classified correctly in about 4–6 seconds. |
| **Nemotron 3.5 Lightning 30B** (Ollama on the Spark) | Agent that chooses backend tools in a safe order (deadlines, then scheduling, then a request for human approval), with an audit trail. Enabled with `AGENT_RUNTIME=python`. |
| **cuOpt 26.10** (on the Spark GPU) | Optimises and re-plans operatives' routes. It re-plans 8 operatives and 37 jobs for a gas emergency in about 1.1 s, moving only one existing visit. |

OR-Tools and a deterministic mock remain as automatic fallbacks. `/health` always reports which scheduler and models are actually in use, and the apps show a **Test mode** badge whenever services are simulated.

## The three screens

| App | Route | Who | What it does |
|---|---|---|---|
| **Resident app** | `/report` | Tenants, on any device | A five-step report form (problem, home, photo/voice, contact, review), a reference number, and live tracking of the repair stages. |
| **Operations** | `/operations` | Housing officers, on a laptop or PC | A 3D digital twin of Sheffield showing cases by severity and hazard. It includes AI triage details, an agent activity log, and a review step for every schedule: the officer compares the proposal with the active plan, then approves it or rejects it with a reason. |
| **Operative** | `/operative` | Repair operatives | Today's visits in route order, with start travelling, arrived on site, and complete or unable to complete. |

The resident and staff apps are separate builds. The resident bundle contains no map or staff code. Both apps support light, dark and system themes.

## Quick start: one laptop, no Spark

Everything runs offline with mock AI. Use Python 3.13 and Node 20+.

```powershell
py -3.13 -m venv .venv
.venv\Scripts\activate
py -m pip install -r requirements.txt
Copy-Item .env.example .env          # USE_MOCKS=true by default
py -m uvicorn backend.app:app --port 8001
```

In a second window:

```powershell
cd frontend
npm install
npm run dev                          # all routes on http://localhost:5173
```

Open `http://localhost:5173/report` to file a report, then `http://localhost:5173/operations` to see it arrive.

## Run with the DGX Spark

The Spark serves Nano Omni on port 8000 and Ollama on port 11434. NVIDIA Sync forwards only the DGX Dashboard and Jupyter, so open an SSH tunnel for the models. Use the SSH alias NVIDIA Sync creates (named after the device, for example `BrightEyes`):

```powershell
# Keep this window open while you work.
ssh -F "$env:LOCALAPPDATA\NVIDIA Corporation\Sync\config\ssh_config" -N `
    -L 18000:127.0.0.1:8000 -L 11434:127.0.0.1:11434 <device-alias>
```

Then use the Spark profile and check both models answer:

```powershell
Copy-Item .env.ollama .env
.venv\Scripts\python.exe scripts\spark\check_endpoints.py   # both lines should say 200
py -m uvicorn backend.app:app --port 8001
```

`/health` should now report `"mocks": false`, and the **Test mode** badge disappears. To use the Lightning agent, set `AGENT_RUNTIME=python` in `.env`. To use cuOpt, run the backend on the Spark itself in its cuOpt environment (see [scripts/spark/RECOVERY.md](scripts/spark/RECOVERY.md)). The demo deployment runs there on port 8100 with `SCHEDULER_ADAPTER=cuopt`.

Before recording or presenting, re-check the models with `py -3.13 -m intake.try_live`.

## Run on two devices (phone and laptop)

```text
        Phone (same Wi-Fi)                           Laptop
  ┌───────────────────────────┐    ┌─────────────────────────────────────────────┐
  │ https://<LAN-IP>:5173     │───▶│ Resident app (Vite :5173, LAN, HTTPS opt.)  │
  │   /report                 │    │      │ /api/* proxied (SSE included)          │
  └───────────────────────────┘    │      ▼                                       │
                                   │ FastAPI backend :8001  (SQLite + /api/stream)│
                                   │      ▲                                       │
                                   │      │ /api/* proxied                        │
                                   │ Staff app (Vite :5174, this laptop only)     │
                                   │   http://localhost:5174/operations, /operative│
                                   └─────────────────────────────────────────────┘
```

The browser only ever calls relative `/api/...` URLs on its own origin, and each Vite dev server forwards them to the backend. That means no CORS, no mixed content and no hard-coded IP addresses.

```powershell
# 1. Backend. Add $env:ALLOW_DEV_RESET="true" to enable the reset button.
py -3.13 -m uvicorn backend.app:app --host 0.0.0.0 --port 8001

# 2. Staff app (this laptop only)
cd frontend; npm run dev:staff              # http://localhost:5174/operations and /operative

# 3. Resident app (exposed on the LAN)
cd frontend; npm run dev:resident:https     # https://<LAN-IP>:5173/report (needed for voice notes)
#        or: npm run dev:resident           # http only: photos and text, no microphone
```

- **LAN address:** run `ipconfig` and use the Wi-Fi adapter's **IPv4 Address**, for example `https://192.168.1.23:5173/report`.
- **Firewall:** the first time the resident server starts, Windows asks whether Node.js may accept connections. Allow it on **Private networks** only.
- **Certificate warning:** the HTTPS mode uses a self-signed certificate. On the phone, choose *Advanced → Proceed*. Phones only allow microphone recording over HTTPS.

`npm run build` builds both apps into `frontend/dist/resident` and `frontend/dist/staff`.

## Demo walkthrough

1. **Report:** on the phone, report black mould in a child's bedroom and attach `demo-photos/mould.jpg`. Nano Omni classifies it as damp and mould and an **emergency**, and the tenant gets a reference.
2. **Arrive:** within about a second, Operations shows a "New report" notice. Press **Locate** to fly to the case and open its details: triage, suggested deadlines, evidence and the agent's activity.
3. **Approve:** open **Schedule**. The proposal's routes appear as dashed lines. Tick *I have reviewed* and press **Approve and activate**. The routes become solid and animate into place.
4. **Do the work:** in **Operative**, the assigned operative starts travelling and arrives on site. Operations and the tenant's tracker both update without a reload.
5. **Emergency:** send `demo-photos/socket.jpg` (a burnt socket) from the phone. It is classified as an electrical emergency, the scheduler re-plans around it, and the officer approves the change. In test mode, **Simulate emergency** creates a gas emergency instead.

The demo inputs and their expected classifications are in [demo-photos/reports.txt](demo-photos/reports.txt).

## Configuration

Copy `.env.example` to `.env`; ready-made profiles are `.env.mock` (offline), `.env.ollama` (DGX Spark) and `.env.hosted` (NVIDIA hosted API backup). Never commit `.env` or API keys.

| Variable | Default | Purpose |
|---|---|---|
| `USE_MOCKS` | `true` | Use mock intake, agent and scheduler. `/health` reports it, and the apps show **Test mode**. |
| `LLM_BASE_URL`, `INTAKE_MODEL` | Spark tunnel, `nemotron_3_nano_omni` | Nano Omni intake endpoint. |
| `AGENT_RUNTIME` | `mock` | `python` uses the Lightning model, `nemoclaw` uses `NEMOCLAW_URL`, and `mock` is deterministic. |
| `AGENT_BASE_URL`, `AGENT_MODEL` | Spark tunnel, `nemotron-3.5-lightning:30b` | Lightning agent endpoint (Ollama). |
| `SCHEDULER_ADAPTER` | `mock` | `cuopt`, `ortools`, `auto` or `mock`; with `SCHEDULER_ALLOW_FALLBACK=true`, a failed solver falls back and says so. |
| `SCHEDULER_SEED_JOBS` | `true` | Adds 36 fixture jobs across 8 operatives. Set it to `false` so new reports are an operative's first job. |
| `ALLOW_DEV_RESET` | `false` | Enables `POST /api/dev/reset` and the reset buttons. Development only. |
| `DATABASE_PATH` | `homeshield.sqlite3` | SQLite file for cases, plans, approvals and events. |
| `VITE_DATA_MODE` | `api` | Frontend: `api` talks to FastAPI; `local` uses the in-browser mock (tests and offline work). |
| `VITE_BACKEND_URL` | `http://127.0.0.1:8001` | Where the frontend dev servers proxy `/api`. |

## Map data

Operations uses **OpenFreeMap** vector tiles (OpenMapTiles schema, data from OpenStreetMap) with buildings extruded to their real heights. Dark and light themes recolour the map without reloading tiles.

For offline use, the twin falls back automatically to local files in `frontend/public/data/`: about 41,000 buildings, 9,000 road segments and 160 place names within 3.5 km of the city centre. To regenerate them:

```powershell
py -3.13 scripts/fetch-sheffield.py                       # from the Overpass API
py -3.13 scripts/fetch-sheffield.py --source openfreemap  # if Overpass is unreachable
```

If WebGL is unavailable, Operations switches to a 2D map that you can still pan and zoom.

## Tests

```powershell
.venv\Scripts\python.exe -m pytest -q backend/tests     # backend, intake, agent, scheduler
cd frontend
npm run typecheck; npm test; npm run build
```

## Troubleshooting

- **The header shows "Connecting…" or "Offline".** Is the backend running? Open `http://localhost:5174/api/health`.
- **Reports take about a minute, or the resident app says the service took too long.** The Lightning agent is spending its tokens on reasoning. Make sure the backend includes the `reasoning_effort` fix (on `fix/merged-integration` until it's merged) and that `AGENT_ENABLE_THINKING=false`.
- **Activity shows "Agent reasoning model unavailable … deterministic fallback used".** The agent model is unreachable or returned an invalid plan. Check the SSH tunnel and `AGENT_MODEL`. The case is still handled safely by the deterministic rules.
- **The Operations map is blank or shows the 2D view.** Check `chrome://gpu` for hardware-accelerated WebGL. After an `npm install` while a dev server was running, restart it with `npm run dev -- --force`.
- **Port already in use.** `netstat -ano | findstr :5173` shows the process ID.
- **The phone can't load the page.** Both devices must be on the same, non-guest Wi-Fi network. Check the firewall rule and use `https` with `dev:resident:https`.

## Repository map

| Path | Contents |
|---|---|
| `backend/` | FastAPI app, Pydantic schemas, service layer, SSE stream, uploads and tests |
| `intake/` | Report analysis: Nano Omni adapter (`real.py`), mock and triage rules |
| `agent/` | Agent orchestrator, permitted tools and deadline rules |
| `scheduler/` | cuOpt, OR-Tools and mock solvers, travel times and benchmark |
| `store/` | SQLite persistence |
| `frontend/` | React + TypeScript: `src/app/` (resident and staff shells), `src/portals/` (resident, operations, operative), `src/shared/` (data service, theme, components) |
| `data/` | Fixtures, the property register and map export helpers ([data/README.md](data/README.md) covers handling real data) |
| `scripts/` | `fetch-sheffield.py` map data and `spark/` checks, recovery and NemoClaw policy |
| `demo-photos/` | Demo photos, voice notes and expected results |
| `docs/` | [Contracts](docs/CONTRACTS.md), [backend integration](docs/BACKEND_INTEGRATION.md), [pitch](docs/PITCH.md), [role runbooks](docs/roles) |

## Responsible use and known limits

- **The AI only suggests.** Severity and deadlines are suggestions; a housing officer confirms them, and every schedule needs human approval before it reaches an operative. Classifications are not official HHSRS determinations.
- **Awaab's Law.** Deadline rules are configurable and must be checked against the official government guidance before they're presented as legal requirements.
- **No staff login yet.** Anyone on the network who knows the address can open the staff apps. Keep ports 5174 and 8001 off the internet and untrusted networks.
- **Sample data.** The property register and operatives are fixtures, and case locations are approximate until a real property register is connected. Real tenant data is personal data under UK GDPR; see [data/README.md](data/README.md).
- **Approval replaces the whole plan.** Approving a proposal currently replaces the active plan rather than merging with it. The review screen lists any approved visits that would drop out.

## Contributors

| Name | Role | Responsibilities |
|---|---|---|
| **Ahmed** | Person 1 | DGX Spark, models and NemoClaw: Spark setup, serving Nemotron 3 Nano Omni and Nemotron 3.5 Lightning, agent runtime |
| **Iyaaz** | Person 2 | Multimodal intake: reading photos, voice notes and text into a structured case |
| **Fowzan** | Person 3 | Backend, compliance and orchestration: FastAPI service, deadline rules, approvals and the live event stream |
| **Aayan** | Person 4 | cuOpt, scheduling and map data: route optimisation, emergency re-planning and Sheffield map data |
| **Enan** | Person 5 | Frontend, digital twin and demo: the resident, Operations and Operative apps, and the demo |

## Attribution

Map tiles: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://www.openmaptiles.org/), data from [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL). Local map files © OpenStreetMap contributors, ODbL 1.0. Demo photo credits are in [demo-photos/CREDITS.txt](demo-photos/CREDITS.txt).
