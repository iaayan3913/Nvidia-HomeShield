# HomeShield

HomeShield is a mock-first, local-AI workflow for turning resident hazard reports into compliant cases and worker schedules. The repository is designed for five people to build in parallel on Friday 13 November 2026, with a FastAPI backend, a React dashboard, and a shared contract.

## First 15 minutes

1. Everyone: clone/pull, copy `.env.example` to `.env`, and read [docs/CONTRACTS.md](docs/CONTRACTS.md).
2. Person 1: run `scripts/spark/smoke_test.sh` and `ollama_inventory.sh` on the Spark.
3. Person 2: run the intake mock test and check `intake/agent.py` returns a `Case`.
4. Person 3: start the API with `py -m uvicorn backend.app:app --reload --port 8001` and open `/docs`.
5. Person 4: run `py -m scheduler.mock` and inspect the sample plan.
6. Person 5: run `npm install` and `npm run dev` in `frontend/`.

## Windows quickstart

```powershell
py -m venv .venv
.venv\Scripts\activate
py -m pip install -r requirements.txt
Copy-Item .env.example .env
py -m uvicorn backend.app:app --reload --port 8001
```

In another PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Set `USE_MOCKS=true` for a completely offline demo. Never commit `.env` or API keys.

## Run HomeShield on two devices

HomeShield is two web apps backed by one FastAPI service. Residents use the **resident app** on a phone, tablet or laptop. Officers and operatives use the **staff app** (`/operations`, `/operative`) on a laptop or PC.

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

The browser only ever calls relative `/api/...` URLs on the page's own origin, and each Vite dev server forwards them to the backend. That means no CORS, no mixed content and no hard-coded IP addresses.

### Commands (three PowerShell windows on the laptop)

```powershell
# 1. Backend, reachable by both dev servers. Add $env:ALLOW_DEV_RESET="true" to enable the reset button.
py -3.13 -m uvicorn backend.app:app --host 0.0.0.0 --port 8001

# 2. Staff app (this laptop only)
cd frontend
npm run dev:staff                 # http://localhost:5174/operations and /operative

# 3. Resident app (exposed on the LAN for phones)
cd frontend
npm run dev:resident:https        # https://<LAN-IP>:5173/report  (needed for voice notes)
# or: npm run dev:resident        # http://<LAN-IP>:5173/report   (photos and text only)
```

Run `npm install` in `frontend/` first. `npm run dev` still starts a combined app with every route on port 5173 for local development. `npm run build` builds both apps into `frontend/dist/resident` and `frontend/dist/staff`. The resident bundle contains no map or staff code.

### Find the laptop's LAN address

Run `ipconfig` and use the **IPv4 Address** of the Wi-Fi adapter (for example `192.168.1.23`). The phone opens `https://192.168.1.23:5173/report`.

### First-run prompts

- **Windows Defender Firewall** asks whether Node.js may accept connections the first time the resident server starts. Allow it on **Private networks** only. If you dismissed the prompt, allow `node.exe` under *Windows Security → Firewall → Allow an app*.
- **HTTPS certificate warning.** `dev:resident:https` uses a self-signed development certificate, so the phone shows "Your connection is not private". Choose *Advanced → Proceed* (Chrome) or *Show details → visit this website* (Safari). Phones only allow microphone recording on HTTPS. Plain HTTP still works for photos and text.

### Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `VITE_DATA_MODE` | `frontend/.env.local` or the shell | `api` | `api` talks to FastAPI. `local` uses the in-browser service (tests and offline work). |
| `VITE_BACKEND_URL` | `frontend/.env.local` or the shell | `http://127.0.0.1:8001` | Where the dev servers proxy `/api`. |
| `ALLOW_DEV_RESET` | root `.env` | `false` | Enables `POST /api/dev/reset` (deletes every case, plan, approval and event) and the reset controls. Development only. |
| `CORS_ORIGINS` | root `.env` | `http://localhost:5173,…` | Not needed in development (the proxy keeps requests same-origin). Set it to the deployed app origins only if production builds call the API from a different origin. |
| `USE_MOCKS` | root `.env` | `true` | When true, `/health` reports `mocks: true` and the apps show a **Test mode** badge. |

### Troubleshooting

- **Staff header stays on "Connecting…" or "Offline · retrying".** Is the backend running? Open `http://localhost:5174/api/health`. If it returns 404, an older backend is still running on port 8001; stop it and restart.
- **Port already in use.** `netstat -ano | findstr :5173` shows the process ID; close that window or end the process.
- **Phone cannot load the page.** Check that both devices are on the same Wi-Fi network (guest networks often isolate devices), that the firewall rule exists, and that you used the IPv4 address and the right scheme (`https` with `dev:resident:https`).
- **Blank page or stale code after pulling.** Run `npm install`, then restart with `npm run dev -- --force` (or `npm run dev:staff -- --force`) to rebuild Vite's dependency cache.
- **Operations map is blank.** The map needs WebGL. Check `chrome://gpu` and confirm WebGL shows *Hardware accelerated*, or try another browser.
- **Reports arrive late.** The stream polls SQLite once per second, so a report normally appears in under 2 seconds. Check the staff header shows **Live**.

### Known risk: staff dashboards have no login

There is no authentication yet. Anyone on the same network who knows the address and port can open the staff dashboards, so the staff server stays on `localhost` by default. Do not expose port 5174 or 8001 to the internet or to untrusted networks.

## Spark quickstart

Only Person 1 deploys to the Spark. Use NVIDIA Sync or SSH, then run:

```bash
bash scripts/spark/smoke_test.sh
bash scripts/spark/ollama_inventory.sh
```

See the five role runbooks in [docs/roles](docs/roles) and the shared gates in [CHECKLIST.md](CHECKLIST.md).

## Repository map

- `backend/`: FastAPI routes and Pydantic contracts
- `intake/`, `agent/`, `scheduler/`, `store/`: replaceable application components
- `frontend/`: offline-first React dashboard starter
- `frontend/mock-build/`: prebuilt HomeShield dashboard running on mock data only (not yet wired to the backend); serve with `npm run mock` in `frontend/` → http://localhost:4173
- `data/`: deterministic synthetic fixtures and map export helpers
- `scripts/spark/`: Spark checks and endpoint helpers

## Important verification items

Items marked `VERIFY:` are deliberately not asserted as facts: confirm the official Awaab's Law guidance, exact Ollama model tags, NemoClaw policy commands, cuOpt aarch64 support, and any hosted model identifiers before relying on them.
