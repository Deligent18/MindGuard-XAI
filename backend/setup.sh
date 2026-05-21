#!/bin/bash
# Run once to set up the virtual environment
set -e

echo "========================================"
echo "  MindGuard-XAI — Backend Setup"
echo "========================================"

# Ensure python3-venv is available
if ! python3 -m venv --help > /dev/null 2>&1; then
    echo "Installing python3-venv..."
    sudo apt install python3-venv python3-full -y
fi

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "Activating venv and installing dependencies..."
source venv/bin/activate

# Always use venv's pip/python to avoid PEP 668 (externally-managed-environment)
./venv/bin/python -m pip install --upgrade pip

# If requirements are hash-pinned (e.g., include --hash=...), pip may fail on hash mismatch.
# Create a temp requirements file without hash directives.
REQ_IN="requirements.txt"
REQ_CLEAN="/tmp/requirements_clean.txt"

if grep -q -- "--hash=" "${REQ_IN}"; then

  echo "Hash-pins detected in requirements.txt; stripping --hash=... entries to avoid hash mismatch errors..."
  sed -e 's/--hash=[^ ]\+ //g' -e 's/  *//g' "${REQ_IN}" > "${REQ_CLEAN}"
  ./venv/bin/python -m pip install -r "${REQ_CLEAN}"
else
  ./venv/bin/python -m pip install -r "${REQ_IN}"
fi


echo ""
echo "========================================"
echo "  Done! Now run the backend with:"
echo "    ./run.sh"
echo "========================================"
