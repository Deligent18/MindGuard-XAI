# TODO_SHAP_ONDEMAND

- [ ] Define/derive `mlReady` in `frontend/xai-risk-sentinel.jsx` from `/predictions-status` (or `pipelineStatus`) and remove any undefined `mlReady` usage.
- [ ] Add on-demand SHAP fetch for counsellor/admin: when selecting a student, if `selected.shap` is empty/missing, call `api.predictStudent(selected.id)`.
- [ ] Merge returned prediction into:
  - `students` array entry (so sidebar updates)
  - `selected` object (so right panel updates)
- [ ] Add guardrails to prevent double in-flight requests for same student.
- [ ] Keep welfare behaviour unchanged (it strips SHAP/explanation).

