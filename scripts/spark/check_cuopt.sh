#!/usr/bin/env bash
# Person 4: check cuOpt on the Spark, solve the fixtures with it, and benchmark every solver.
#
# cuOpt 26.10.1 (cu13) is installed in ~/cuopt-env (Person 1, 13 Nov). Run from the repo root:
#   PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh --deps   # first time: add pydantic + ortools
#   PYTHON=~/cuopt-env/bin/python bash scripts/spark/check_cuopt.sh          # afterwards
#
#   --deps     pip install the scheduler's own packages (pydantic, ortools) into $PYTHON; cuOpt is untouched
#   --install  also pip install cuOpt (only for a fresh environment without it)
#
# Python: $PYTHON if set, else .venv/bin/python if present, else python3.
# Output is saved to data/generated/cuopt_status.txt; paste it into
# docs/roles/04-cuopt-scheduling-mapdata.md (Status section).
set -uo pipefail

if [ -n "${PYTHON:-}" ]; then PY="$PYTHON"
elif [ -x .venv/bin/python ]; then PY=.venv/bin/python
else PY=python3; fi
OUT=data/generated/cuopt_status.txt
mkdir -p data/generated

{
  echo "== cuOpt check $(date -u +%Y-%m-%dT%H:%MZ) on $(hostname) ($(uname -m)) using $PY"
  nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null || echo "nvidia-smi unavailable"
  CUDA_MAJOR=$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\).*/\1/p' | head -1)
  echo "CUDA driver major: ${CUDA_MAJOR:-unknown}; python: $($PY --version 2>&1)"

  if [ "${1:-}" = "--install" ]; then
    PKG=cuopt-cu13
    [ "${CUDA_MAJOR:-13}" = "12" ] && PKG=cuopt-cu12
    echo "== pip install $PKG"
    $PY -m pip install --extra-index-url=https://pypi.nvidia.com "$PKG" 2>&1 | tail -3
  fi
  if [ "${1:-}" = "--install" ] || [ "${1:-}" = "--deps" ]; then
    echo "== pip install scheduler dependencies (pydantic, ortools)"
    $PY -m pip install "pydantic>=2" ortools 2>&1 | tail -2
  fi

  MISSING=$($PY -c "
import importlib.util as u
print(' '.join(m for m in ('pydantic', 'ortools', 'cuopt') if u.find_spec(m) is None))" 2>&1)
  if [ -n "$MISSING" ]; then
    echo "MISSING modules for $PY: $MISSING  -> re-run with --deps (or --install if cuopt is missing)"
  fi

  echo "== import + fixture solve"
  $PY -m scheduler.cuopt 2>&1 | tail -5
  echo "== benchmark (all available solvers, gas emergency at 11:00)"
  $PY -m scheduler.benchmark 2>&1 | tail -12
} | tee "$OUT"

echo "saved -> $OUT"
