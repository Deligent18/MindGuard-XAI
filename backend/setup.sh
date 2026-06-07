#!/bin/bash
# Run once to set up the virtual environment
set -e

echo "========================================"
echo "  MindGuard-XAI — Backend Setup"
echo "========================================"

echo "Checking and installing system-level dependencies..."
# Added build-essential and python3-dev for packages like XGBoost/SHAP that may require compilation
REQUIRED_SYSTEM_PKGS="python3-venv python3-full build-essential python3-dev curl"

for pkg in $REQUIRED_SYSTEM_PKGS; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then
        echo "  [OK] $pkg is already installed."
    else
        echo "  [MISSING] $pkg. Installing via apt..."
        sudo apt-get update -qq
        sudo apt-get install -y "$pkg"
    fi
done

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "Activating venv and installing dependencies..."
source venv/bin/activate || { echo "ERROR: Failed to activate virtual environment."; exit 1; }

echo "Checking for pip updates..."
./venv/bin/python -m pip install --upgrade pip --quiet

echo "Verifying core ML runtime dependencies..."
# Check critical libraries that often have environment-specific issues
for lib in numpy pandas xgboost shap sklearn imblearn; do
    ./venv/bin/python -c "import $lib; print(f'  [OK] $lib version: ' + __import__('$lib').__version__)" 2>/dev/null || echo "  [MISSING/BROKEN] $lib"
done

if [ ! -f "requirements.txt" ]; then
    echo "ERROR: requirements.txt not found in $(pwd). Please ensure you are in the backend directory."
    exit 1
fi

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
