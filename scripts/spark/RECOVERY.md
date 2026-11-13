# HomeShield Spark recovery (spark6, 10.41.30.19)

## 1. Lightning (agent) - keep loaded, 32k window
curl -s http://localhost:11434/api/generate -d '{"model":"nemotron-3.5-lightning:30b","keep_alive":-1}'
tmux new -d -s keepwarm 'while true; do curl -s http://localhost:11434/api/generate -d "{\"model\":\"nemotron-3.5-lightning:30b\",\"keep_alive\":-1}" >/dev/null; sleep 120; done'
# 32k window was set with: ollama create lightning-32k (FROM nemotron-3.5-lightning:30b + PARAMETER num_ctx 32768), then ollama cp lightning-32k nemotron-3.5-lightning:30b

## 2. Nano Omni (port 8000) - run inside tmux "omni"
docker run --rm -it --gpus all --ipc=host -p 8000:8000 --shm-size=16g --name vllm-omni -v ~/models/omni:/model:ro --entrypoint /bin/bash vllm/vllm-openai:v0.20.0 -c "pip install vllm[audio] && vllm serve /model --served-model-name nemotron_3_nano_omni --port 8000 --trust-remote-code --max-num-seqs 8 --max-model-len 32768 --gpu-memory-utilization 0.40 --limit-mm-per-prompt '{\"video\": 1, \"image\": 1, \"audio\": 1}' --reasoning-parser nemotron_v3 --enable-auto-tool-choice --tool-call-parser qwen3_coder"

## 3. Backend (port 8100) - run inside tmux "backend"
cd ~/Nvidia-HomeShield
set -a; source .env.ollama; set +a
export AGENT_RUNTIME=python INTAKE_ADAPTER=real
# Strict proof run: fail truthfully instead of falling back if cuOpt cannot load/solve.
export SCHEDULER_ADAPTER=cuopt SCHEDULER_ALLOW_FALLBACK=false
~/cuopt-env/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8100

# For the resilient hackathon demo after strict cuOpt verification:
# export SCHEDULER_ALLOW_FALLBACK=true
# A fallback is exposed in /health and plan.proposed payload metadata; it is never labelled cuOpt.

## 4. NemoClaw (if the sandbox is recreated)
nemoclaw homeshield policy add --from-file scripts/spark/nemoclaw/homeshield-policy.yaml --trusted-private-host 10.41.30.19
# then inside the sandbox: openclaw config set tools.profile coding
# always /new before each agent task (context fills fast)

## Health checks
curl -s http://localhost:8000/v1/models
curl -s http://localhost:8100/health
curl -s http://localhost:8100/health | python3 -m json.tool
docker exec spark-hack-ollama ollama ps
free -h

## cuOpt proof before starting the backend
PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh --deps
PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh
# Require: "cuopt ... import OK", a fixture plan whose solver is cuopt, and validation OK.
# Output is saved to data/generated/cuopt_status.txt.
# The backend must run in this same cuOpt environment; install its remaining packages once:
# ~/cuopt-env/bin/python -m pip install -r requirements.txt
