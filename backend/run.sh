#!/bin/bash
# Activate venv and start the backend server
set -e

if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Running setup first..."
    ./setup.sh
fi

source venv/bin/activate
echo "Starting MindGuard-XAI backend on http://localhost:8000"
uvicorn server:app --reload --host 0.0.0.0 --port 8000
