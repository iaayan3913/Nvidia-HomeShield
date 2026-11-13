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
