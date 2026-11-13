# Person 1 — Spark, models and NemoClaw

## Goal and ownership

Own Spark access, model serving, NemoClaw/OpenShell, and the hosted fallback. Own `scripts/spark/` and model settings; do not edit intake or scheduling logic.

## Inputs and outputs

Input: DGX Spark, venue network, `.env.example`. Output: reachable OpenAI-compatible endpoint, exact model IDs in a private `.env`, and one approved HomeShield tool call.

## Steps

Laptop (PowerShell):

```powershell
Copy-Item .env.example .env
ssh user@<spark-ip>
```

Spark (Linux):

```bash
bash scripts/spark/smoke_test.sh
bash scripts/spark/ollama_inventory.sh
curl http://localhost:11434/v1/models
```

If laptops cannot reach Ollama, use `ssh -L 11434:localhost:11434 user@<spark-ip>`; see [expose_ollama.md](../../scripts/spark/expose_ollama.md). `VERIFY:` model tags, image payload format, tool calls, reasoning field, and NemoClaw policy commands.

## Solo test

Run `py scripts/spark/check_endpoints.py` from a laptop. `LLM_BASE_URL`/`INTAKE_MODEL`
select Nano Omni; `AGENT_BASE_URL`/`AGENT_MODEL` select Nemotron Lightning. Keep
`NEMOCLAW_URL` independent. For tunnels, use local port 18000 for Spark's Omni port 8000 so it
does not collide with FastAPI on 8001.

## Checkpoints

- 10:45: smoke and inventory pass.
- 13:00: Person 2 can call the endpoint.
- 15:00: NemoClaw or Python fallback can call one backend tool.
- Done: stable server, monitored memory, hosted fallback documented.

## Checklist

- [ ] Spark reachable and smoke test passed.
- [ ] Ollama inventory recorded.
- [ ] Shared endpoint tested by Person 2.
- [ ] NemoClaw tool call or Python fallback demonstrated.
- [ ] Hosted profile and recovery path tested.
