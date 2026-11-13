#!/usr/bin/env bash
set -euo pipefail
ollama list
ollama ps
curl -fsS http://localhost:11434/v1/models
echo "VERIFY: test image input, tool calling, reasoning output, and exact model tags."
