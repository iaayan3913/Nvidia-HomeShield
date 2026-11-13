#!/usr/bin/env bash
set -euo pipefail
nvidia-smi
uname -m
free -h
df -h
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
