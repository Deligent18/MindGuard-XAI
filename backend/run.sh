#!/bin/bash
# Activate venv and start the backend server
set -e

if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Running setup first..."
    ./setup.sh
fi

source venv/bin/activate
echo "Starting MindGuard-XAI backend on http://localhost:8000"

# server.py uses relative imports (e.g. `from .db import ...`), so ensure the
# repo root is on PYTHONPATH and import the app via `backend.server:app`.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PYTHONPATH="$REPO_ROOT:$PYTHONPATH"

APP_IMPORT_TARGET="backend.server:app"
HOST="0.0.0.0"
PORT="8000"

# Ensure uvicorn is always launched in a way that preserves package context.
# From within backend/: importing `backend.server:app` requires PYTHONPATH=repo root.
if [ -f "venv/bin/uvicorn" ]; then
  exec ./venv/bin/uvicorn "$APP_IMPORT_TARGET" --reload --host "$HOST" --port "$PORT"
else
  # Fallback: run uvicorn as a module using the venv python
  exec venv/bin/python -m uvicorn "$APP_IMPORT_TARGET" --reload --host "$HOST" --port "$PORT"
fi







