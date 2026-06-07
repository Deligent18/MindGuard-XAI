# TODO — LIME integration for MindGuard-XAI

- [ ] Update plan approved: implement LIME end-to-end (backend + frontend)
- [x] Add lazy LIME import to `backend/ml_pipeline.py`
- [x] Implement `MLPipeline.generate_lime_explanation()` (local, per-student)
- [x] Update `MLPipeline.predict_single()` to return a `lime` field
- [x] Add `lime` dependency to `backend/requirements.txt`
- [ ] Frontend: add a LIME section under the SHAP area (only counsellor/admin)
- [x] Install/update python deps in backend venv (pip install -r requirements.txt)
- [ ] Restart backend + frontend dev server
- [ ] Test: `curl -X POST http://localhost:8000/students/batch`, then login as counsellor and verify LIME appears for a student
