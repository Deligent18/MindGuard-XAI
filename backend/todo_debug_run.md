# TODO - Fix backend uvicorn import errors

## Info gathered
- `backend/run.sh` runs `./backend/venv/bin/uvicorn backend.server:app ...` after `cd ..`.
- The repo has `backend/server.py` and `backend/__init__.py`.
- Runtime error shown by user: `ModuleNotFoundError: No module named 'backend'`.

## Plan
1. Fix the uvicorn app import path in `run.sh` so it matches the actual working directory.
   - Prefer using `uvicorn server:app` (module `server.py`) when running from the `backend/` dir.
   - Alternatively use `uvicorn MindGuard-XAI.backend.server:app` if package name is correct, but repo name suggests `backend` is a top-level module only when PYTHONPATH points correctly.
2. Ensure we always start uvicorn from the `backend/` directory (no `cd ..`).
3. Add a `--app-dir` if needed to make imports deterministic.
4. Re-run `./run.sh` and confirm `/health` responds.

## Dependent files
- `MindGuard-XAI/backend/run.sh`

## Followup steps
- Run `cd MindGuard-XAI/backend && ./run.sh`.
- In a separate terminal: `curl http://localhost:8000/health`.

