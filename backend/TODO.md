# TODO

## Info gathered
- `backend/server.py` defines the FastAPI app as `app = FastAPI(...)`.
- `backend/server.py` uses relative imports like `from .db import ...`.
- `backend/run.sh` starts uvicorn from inside `backend/` and currently uses `uvicorn server:app`, which can break relative-import resolution.

## Plan (approved)
1. Edit `backend/run.sh` so uvicorn imports the app as `backend.server:app`.
2. Ensure import resolution is deterministic by setting `PYTHONPATH` to the project root before launching uvicorn.
3. Re-run `./run.sh` and verify `/health` works.

## Status
- [x] Patch `backend/run.sh` (uvicorn target + PYTHONPATH)
- [x] Run backend and verify `/health`


