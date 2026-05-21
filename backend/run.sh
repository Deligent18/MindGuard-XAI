#!/bin/bash
# Activate venv and start the backend server
set -e

if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Running setup first..."
    ./setup.sh
fi

source venv/bin/activate
echo "Starting MindGuard-XAI backend on http://localhost:8000"

# server.py uses relative imports (e.g. `from .db import ...`), so we must ensure
# Python treats `backend/` as a package. To do that deterministically, set
# PYTHONPATH to the repository root (one level above this script's directory)
# and import via `backend.server:app`.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PYTHONPATH="$REPO_ROOT:$PYTHONPATH"

if [ -f "venv/bin/uvicorn" ]; then
  ./venv/bin/uvicorn backend.server:app --reload --host 0.0.0.0 --port 8000
else
  # Fallback: run uvicorn as a module using the venv python
  venv/bin/python -m uvicorn backend.server:app --reload --host 0.0.0.0 --port 8000
fi





