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
pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "========================================"
echo "  Done! Now run the backend with:"
echo "    ./run.sh"
echo "========================================"
