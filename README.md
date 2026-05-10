# Sentinel-XAI

**Student Mental Health Risk Monitoring System with Explainable AI**

A production-ready platform that predicts mental health risks among university students using **XGBoost + SHAP** and delivers transparent, actionable explanations to counsellors and welfare officers.

![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi)
![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react)
![XGBoost](https://img.shields.io/badge/XGBoost-5C5C5C?style=flat)
![GitHub Actions](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=flat&logo=github-actions)

## ✨ Features

- **Real-time risk dashboard** — paginated list of 1,200+ students with instant filtering and search
- **SHAP explainability** — per-student feature contributions explaining every prediction
- **Role-based access** — Admin / Mental Health Counsellor / Student Welfare Officer
- **WebSocket live updates** — predictions refresh in the browser as ML completes
- **Two-phase ML loading** — rule-based scores serve instantly; real XGBoost+SHAP enriches in background
- **CSV + MySQL** — works without a database; MySQL used when available

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/Deligent18/MindGuard-XAI.git
cd MindGuard-XAI

# 2. Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**

| Role | Username | Password |
|------|----------|----------|
| Mental Health Counsellor | `counsellor1` | `Care@2026` |
| Student Welfare Officer | `welfare1` | `Welfare@2026` |
| System Administrator | `admin` | `Admin@2026` |

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI + Python 3.11 |
| ML | XGBoost + SHAP + scikit-learn |
| Frontend | React 18 + Vite |
| Auth | JWT (python-jose) + bcrypt |
| Database | MySQL (optional) + in-memory fallback |
| CI/CD | GitHub Actions |

## 📁 Project Structure

```
MindGuard-XAI/
├── backend/                  # FastAPI application
│   ├── server.py             # Main API + lifespan startup
│   ├── ml_pipeline.py        # XGBoost training + SHAP inference
│   ├── data_service.py       # CSV loading + student formatting
│   ├── db.py                 # User auth (MySQL + in-memory fallback)
│   └── data/students.csv     # 1,200 student dataset
├── frontend/                 # React + Vite application
│   ├── xai-risk-sentinel.jsx # Main dashboard component
│   └── src/api.js            # API client + WebSocket manager
├── generate_synthetic_data.py
├── data_preprocessing.py
├── model_training.py
├── model_evaluation.py
├── shap_generation.py
└── .github/workflows/        # CI/CD pipeline
    └── sentinel-stack.yml
```

## 🔄 ML Pipeline

```
generate_synthetic_data.py   →  backend/data/students.csv
data_preprocessing.py        →  data/processed/  (feature engineering)
model_training.py            →  models/active_model.pkl
model_evaluation.py          →  reports/ + plots/
shap_generation.py           →  reports/shap_analysis.json
```

Run in order for a full retrain. The backend auto-trains on startup if no model is found.

## 🧪 CI/CD

GitHub Actions runs on every push:

1. **Backend job** — lint, ML pipeline, API tests (all endpoints)
2. **Frontend job** — build verification (parallel)
3. **Integration job** — full-stack smoke tests

Expected duration: **4–6 minutes**

## 📚 Documentation

- [Execution Guide](EXECUTION_GUIDE.md)
- [Implementation Plan](IMPLEMENTATION_PLAN.md)
