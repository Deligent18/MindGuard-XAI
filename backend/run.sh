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

# Load environment variables from .env if it exists
if [ -f ".env" ]; then
    echo "Loading environment variables from .env"
    export $(grep -v '^#' .env | xargs)
fi

# Configuration with environment fallbacks
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
RELOAD="${RELOAD:-true}"
APP_IMPORT_TARGET="backend.server:app"

UVICORN_CMD="./venv/bin/python -m uvicorn"

echo "Starting server on $HOST:$PORT (reload=$RELOAD)..."
if [ "$RELOAD" = "true" ]; then
    exec $UVICORN_CMD "$APP_IMPORT_TARGET" --reload --host "$HOST" --port "$PORT"
else
    exec $UVICORN_CMD "$APP_IMPORT_TARGET" --host "$HOST" --port "$PORT"
fi
