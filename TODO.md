# TODO (MindGuard-XAI)

## Current objective
Restore real per-student SHAP explanations on-demand (fast server responses, avoid SHAP in daemon threads) and keep welfare role free from SHAP/explanation.

## Steps
- [x] 1) Inspect and fix data->ML feature key mapping in `backend/data_service.py` so `pipeline.predict_single()` receives all required engineered-feature inputs.
- [ ] 2) Ensure `POST /pipeline/predict/{student_id}` in `backend/server.py` returns and stores the exact prediction keys frontend merges: `risk`, `tier`, `shap`, `explanation`, `intervention`, `lastUpdated`.
- [ ] 3) Enforce role-based shielding for welfare (no SHAP/explanation leaks) in the on-demand predict endpoint path.
- [ ] 4) Run a local sanity test: call prediction endpoint and verify response contains non-empty `shap` for counsellor/admin.
- [ ] 5) Verify UI integration: opening a student shows SHAP bars and explanation.

