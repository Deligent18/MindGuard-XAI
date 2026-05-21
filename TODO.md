# MindGuard-XAI Backend TODO

## Goal
Restore **real per-student SHAP** explanations while keeping the FastAPI server responsive and avoiding SHAP-related deadlocks/OOM.

## Implementation Steps
- [ ] 1) Inspect current SHAP behavior in `backend/server.py` (background thread) and `backend/ml_pipeline.py` (how `predict_single()` generates SHAP).
- [ ] 2) Add a safe SHAP mode for per-student explanations:
  - [ ] Compute SHAP only on-demand (for `/students/{id}` and optionally a new batch endpoint), not for all 1200+ students at startup.
  - [ ] Avoid SHAP inside daemon threads; move SHAP computation to a non-daemon worker (or run synchronously only for single-student requests with tight bounds).
  - [ ] Ensure correct feature matrix (`X`) is used when calling `generate_shap_explanation()`. 

- [ ] 3) Update API endpoints to support per-student SHAP refresh:
  - [ ] Add/adjust endpoint(s) that trigger SHAP generation for a student or filtered set.
  - [ ] Ensure role-based filtering still hides SHAP/explanation from welfare users.
- [ ] 4) Keep existing fast CSV/risk tier load as-is.
- [ ] 5) Update the front-end contract only if necessary (ideally keep response shape stable).
- [ ] 6) Run backend locally and verify:
  - [ ] `/students` returns quickly
  - [ ] `/students/{id}` includes SHAP/explanation for counsellor/admin after SHAP generation is triggered
  - [ ] `/predictions-status` remains responsive

## Notes / Constraints
- SHAP can deadlock/hang in certain environments when run inside daemon threads.
- The current server uses a global feature-importance substitute to avoid those issues; we will replace that with safe, on-demand per-student SHAP.

