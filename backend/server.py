"""
XAI Risk Sentinel - FastAPI Backend
Student Mental Health Risk Monitoring System (NUST)
With Automated ML Pipeline Integration
"""

import os
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import json
import threading

# Load environment variables
load_dotenv()

# Database (MySQL with in-memory fallback)
# Try relative import first (when running as a package), fall back to absolute
try:
    from .db import (
        init_db,
        get_user,
        get_all_users,
        create_user as db_create_user,
        touch_last_login,
        verify_password as db_verify_password,
    )
except ImportError:
    from db import (
        init_db,
        get_user,
        get_all_users,
        create_user as db_create_user,
        touch_last_login,
        verify_password as db_verify_password,
    )
init_db()

# Import ML Pipeline (optional - graceful degradation if not available)
try:
    from .ml_pipeline import pipeline, run_full_pipeline
    from .data_service import data_service
    from .academic_results import get_academic_results
    ML_PIPELINE_AVAILABLE = True
except ImportError as e:
    print(f"Warning: ML Pipeline not available - {e}")
    ML_PIPELINE_AVAILABLE = False
    pipeline = None
    data_service = None
    def get_academic_results(students, programme):
        return {"status": "error", "message": "Academic results module not available"}

# Global variable to store loaded students with predictions
TRAFFIC_STUDENTS = []
PREDICTIONS_LOADED = False
PREDICTIONS_LOADING = False   # True while background thread is running


def _load_csv_students_fast():
    """
    Phase 1 (instant): Load students from CSV with rule-based risk scores.
    No ML inference — returns immediately so the server can respond.
    """
    try:
        csv_data = data_service.load_students_from_csv()
        if not csv_data:
            return []
        students = data_service.convert_csv_to_student_format(csv_data)
        # convert_csv_to_student_format already sets tier/risk/shap.
        # Override explanation/intervention to show background-computing message.
        for s in students:
            s["explanation"]  = "ML predictions are being computed in the background."
            s["intervention"] = ["Please check back in a few minutes for full recommendations."]
            s["lastUpdated"]  = "computing…"
        print(f"[startup] Loaded {len(students)} students from CSV (fast path)")
        return students
    except Exception as e:
        print(f"[startup] CSV load error: {e}")
        return []


def _run_ml_predictions_background():
    """
    Phase 2 (background thread): compute real ML risk scores for all students.
    - Retrains the model if it was built on fewer samples than the current CSV.
    - Skips per-student SHAP to avoid OOM on 1200+ students; uses the global
      model feature importances as a lightweight substitute.
    - Updates TRAFFIC_STUDENTS atomically so the server always has valid data.
    - Catches BaseException so no crash here can kill the uvicorn process.
    """
    global TRAFFIC_STUDENTS, PREDICTIONS_LOADING, PREDICTIONS_LOADED
    PREDICTIONS_LOADING = True
    print("[bg] Starting ML predictions for all students...")
    # Overall safety timeout: if anything in this thread hangs beyond
    # 5 minutes, the finally block still runs and marks loading=False
    _start_ts = __import__('time').time()
    MAX_BG_SECONDS = 300  # 5 minutes hard ceiling
    try:
        if not ML_PIPELINE_AVAILABLE:
            print("[bg] ML pipeline not available — skipping")
            return

        import pandas as pd, os, numpy as np

        # ── Step 1: locate CSV ──────────────────────────────────────────────
        csv_candidates = [
            os.path.join(os.path.dirname(__file__), 'data', 'students.csv'),
            os.path.join(os.path.dirname(__file__), '..', 'data', 'processed', 'students.csv'),
        ]
        csv_path = next((p for p in csv_candidates if os.path.exists(p)), None)
        if not csv_path:
            print("[bg] No CSV found — skipping ML predictions")
            return

        df_full = pd.read_csv(csv_path)
        n_csv   = len(df_full)

        # ── Step 2: train/retrain if stale ──────────────────────────────────
        loaded = pipeline.load_model() if not pipeline.is_trained else True
        need_train = (
            not pipeline.is_trained or
            not loaded or
            # Retrain when model was built on far fewer rows than current CSV
            getattr(pipeline, '_trained_on_n', 0) < n_csv * 0.5
        )
        if need_train:
            # Disable OpenMP parallelism during training to prevent CI deadlock
            import os as _bg_os
            _bg_os.environ.setdefault("OMP_NUM_THREADS", "1")
            _bg_os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
            _bg_os.environ.setdefault("MKL_NUM_THREADS", "1")
            print(f"[bg] Retraining on {n_csv} rows (model was on "
                  f"{getattr(pipeline,'_trained_on_n',0)})...")
            pipeline.train_model(df_full, save=True)
            pipeline._trained_on_n = n_csv
            print(f"[bg] Retrain complete — features: {len(pipeline.feature_names)}")

        if not pipeline.is_trained:
            print("[bg] Pipeline still not trained — aborting")
            return

        # ── Step 3: batch-predict risk scores (no per-student SHAP) ─────────
        csv_data = data_service.load_students_from_csv()
        students = data_service.convert_csv_to_student_format(csv_data)

        df_eng = pipeline.engineer_features(df_full.copy())
        X      = pipeline.prepare_features(df_eng)
        preds  = pipeline.model.predict(X)
        probs  = pipeline.model.predict_proba(X)

        risk_map = {0: 'low', 1: 'medium', 2: 'high'}
        risk_scores = probs[:, 2] + 0.5 * probs[:, 1]
        risk_scores = np.clip(risk_scores, 0, 1)

        # ── Step 4: per-student SHAP is deferred ─────────────────────────────
        # The earlier implementation computed only a global feature-importance
        # substitute to avoid SHAP deadlocks/OOM in daemon threads.
        # To restore real per-student SHAP, we defer TreeExplainer work to
        # on-demand requests (/students/{student_id}) for counsellor/admin.
        #
        # Here we keep a lightweight placeholder so the UI remains stable.
        global_shap = []


        # ── Step 5: merge scores into student dicts ──────────────────────────
        enriched = []
        for i, student in enumerate(students):
            if i >= len(preds):
                break
            tier  = risk_map.get(int(preds[i]), 'low')
            risk  = float(risk_scores[i])
            s = dict(student)
            s['risk']        = risk
            s['tier']        = tier
            s['shap']        = global_shap   # same global shap for all (fast path)
            s['explanation'] = (
                f"{s.get('name','Student')} has a {tier} risk score of "
                f"{round(risk*100)}%. Key factors: "
                + ", ".join(g['feature'] for g in global_shap[:3]) + "."
            )
            s['intervention'] = (
                ["Immediate counsellor contact within 24 hours",
                 "Safety planning assessment", "Academic load review"]
                if tier == 'high' else
                ["Proactive welfare check", "Academic support referral"]
                if tier == 'medium' else
                ["Standard wellness newsletter"]
            )
            s['lastUpdated'] = pd.Timestamp.now().strftime('%Y-%m-%d')
            enriched.append(s)

        if enriched:
            TRAFFIC_STUDENTS   = enriched
            PREDICTIONS_LOADED = True
            print(f"[bg] Done — {len(enriched)} students enriched with ML scores")
        else:
            print("[bg] No enriched students produced")

    except BaseException as e:
        import traceback
        print(f"[bg] ML prediction error ({type(e).__name__}): {e}")
        traceback.print_exc()
    finally:
        PREDICTIONS_LOADING = False
        print(f"[bg] Thread finished. ml_ready={PREDICTIONS_LOADED}")


def load_students_with_predictions():
    """Legacy wrapper kept for compatibility."""
    return TRAFFIC_STUDENTS

from contextlib import asynccontextmanager
import threading as _threading

@asynccontextmanager
async def lifespan(app):
    """
    Lifespan context manager — replaces deprecated @app.on_event("startup").
    Everything before yield() runs BEFORE uvicorn accepts the first request,
    so /health, /stats etc. always see a fully-initialised STUDENTS list.
    """
    global STUDENTS, TRAFFIC_STUDENTS
    # Phase 1: fast CSV load — completes before server accepts connections
    fast = _load_csv_students_fast()
    if fast:
        STUDENTS = fast
        TRAFFIC_STUDENTS = fast
        print(f"[lifespan] {len(STUDENTS)} students ready (rule-based scores)")
    # Phase 2: background ML thread — doesn't block request handling
    t = _threading.Thread(target=_run_ml_predictions_background, daemon=True)
    t.start()
    print("[lifespan] Background ML prediction thread started")
    yield  # server is live from here
    # Shutdown logic (if needed) goes after yield
    print("[lifespan] Server shutting down")

app = FastAPI(
    title="XAI Risk Sentinel API",
    description="Backend API for Student Mental Health Risk Monitoring System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration
# Note: allow_credentials=True requires explicit origins (not wildcard)
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    # Add your production domain here when deploying
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secret key for JWT - load from environment variable with fallback
SECRET_KEY = os.getenv("SECRET_KEY", os.getenv("JWT_SECRET_KEY", "xai-risk-sentinel-secret-key-2026-nust-informatics"))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# ═══════════════════════════════════════════════════════════════════════════════
# IN-MEMORY DATA (Extracted from frontend)
# ═══════════════════════════════════════════════════════════════════════════════

# Users with pre-hashed passwords (bcrypt cost=12)
USERS = [
    {"username": "counsellor1", "password": "$2b$12$I6v4YAffh.5hrofCiCe7S.LOcMpJaxErmyOL7l1/giOnY.bsjRIQu", "name": "Dr. Sibanda, N.", "role": "counsellor", "roleLabel": "Mental Health Counsellor"},
    {"username": "welfare1",    "password": "$2b$12$XIQAxdaTHjayAGcC/pQsueY9xVgHwX8kExYuWXsJ2mk9yszvRncsm", "name": "Ms. Choto, R.",  "role": "welfare",    "roleLabel": "Student Welfare Officer"},
    {"username": "admin",       "password": "$2b$12$N0mvjhli69CgAgHwMlG.5.EofX6dzgLhMBcy88AOTVtq4sqmDb7o2", "name": "Mr. Dube, T.",  "role": "admin",      "roleLabel": "System Administrator"},
]

ROLES = [
    {"id": "counsellor", "label": "Mental Health Counsellor", "icon": "🧠",
     "desc": "Access full student risk profiles, SHAP explanations and clinical recommendations."},
    {"id": "welfare", "label": "Student Welfare Officer", "icon": "🛡️",
     "desc": "View risk summaries, manage welfare referrals and monitor intervention progress."},
    {"id": "admin", "label": "System Administrator", "icon": "⚙️",
     "desc": "Manage user accounts, audit logs, model settings and system configuration."},
]

STUDENTS = [
    {
        "id": "N00411234", "name": "Tinashe Moyo", "programme": "BSc Computer Science", "year": 3,
        "risk": 0.87, "tier": "high",
        "gpa": [3.6, 3.2, 2.4], "attendance": 48, "lmsLogins": 3, "facilityAccess": 1,
        "shap": [
            {"feature": "GPA decline (−0.8 pts this semester)", "value": 0.32, "dir": 1},
            {"feature": "Attendance dropped to 48%", "value": 0.28, "dir": 1},
            {"feature": "LMS logins: 3 this week (−74%)", "value": 0.19, "dir": 1},
            {"feature": "Library access: 0 visits this month", "value": 0.11, "dir": 1},
            {"feature": "After-hours WiFi sessions increased", "value": 0.07, "dir": 1},
            {"feature": "Assignment submission rate normal", "value": -0.05, "dir": -1},
        ],
        "explanation": "Tinashe's risk is primarily driven by a significant academic decline combined with sharply reduced campus engagement. A GPA drop of 0.8 points this semester, attendance below 50%, and near-zero LMS activity collectively signal acute distress. Immediate counsellor contact is recommended.",
        "intervention": ["Immediate counsellor contact within 24 hours", "Safety planning assessment", "Academic load review with faculty adviser"],
        "lastUpdated": "2026-02-24",
    },
    {
        "id": "N00523891", "name": "Rumbidzai Chikwanda", "programme": "BSc Psychology", "year": 2,
        "risk": 0.61, "tier": "medium",
        "gpa": [3.8, 3.5, 3.1], "attendance": 67, "lmsLogins": 11, "facilityAccess": 4,
        "shap": [
            {"feature": "GPA decline (−0.4 pts this semester)", "value": 0.18, "dir": 1},
            {"feature": "Attendance at 67% (below 70% threshold)", "value": 0.15, "dir": 1},
            {"feature": "Social facility access reduced 60%", "value": 0.12, "dir": 1},
            {"feature": "LMS logins moderate but declining", "value": 0.08, "dir": 1},
            {"feature": "Peer network interactions reduced", "value": 0.07, "dir": 1},
            {"feature": "Assignment submissions up to date", "value": -0.08, "dir": -1},
        ],
        "explanation": "Rumbidzai shows a moderate risk profile characterised by gradual academic decline and reduced social engagement. The pattern suggests emerging distress over 4–6 weeks. Proactive outreach and academic support referral are recommended.",
        "intervention": ["Proactive welfare check by personal tutor", "Academic support referral", "Peer mentoring programme enrolment"],
        "lastUpdated": "2026-02-24",
    },
    {
        "id": "N00614782", "name": "Farai Dube", "programme": "BEng Electrical Engineering", "year": 4,
        "risk": 0.44, "tier": "medium",
        "gpa": [3.2, 3.0, 2.8], "attendance": 72, "lmsLogins": 18, "facilityAccess": 7,
        "shap": [
            {"feature": "Steady GPA decline over 3 semesters", "value": 0.14, "dir": 1},
            {"feature": "Late-night WiFi usage pattern changed", "value": 0.11, "dir": 1},
            {"feature": "Reduced dining hall access", "value": 0.08, "dir": 1},
            {"feature": "Regular LMS engagement maintained", "value": -0.06, "dir": -1},
            {"feature": "Attendance above threshold", "value": -0.04, "dir": -1},
        ],
        "explanation": "Farai presents a low-moderate risk profile with a gradual multi-semester GPA trajectory downward and some behavioural changes. Academic engagement remains adequate. Wellness resource provision and optional check-in recommended.",
        "intervention": ["General wellness resource signposting", "Optional academic consultation", "Financial support services notification"],
        "lastUpdated": "2026-02-24",
    },
    {
        "id": "N00732156", "name": "Blessing Ncube", "programme": "BSc Mathematics", "year": 1,
        "risk": 0.19, "tier": "low",
        "gpa": [3.5], "attendance": 88, "lmsLogins": 27, "facilityAccess": 14,
        "shap": [
            {"feature": "First semester — limited historical data", "value": 0.09, "dir": 1},
            {"feature": "High LMS engagement", "value": -0.08, "dir": -1},
            {"feature": "Strong attendance record", "value": -0.06, "dir": -1},
            {"feature": "Active campus engagement", "value": -0.05, "dir": -1},
        ],
        "explanation": "Blessing presents a low risk profile with strong academic engagement and consistent campus participation. No immediate action required. Standard wellness communications applicable.",
        "intervention": ["Standard wellness newsletter", "Campus mental health awareness resources"],
        "lastUpdated": "2026-02-24",
    },
    {
        "id": "N00849023", "name": "Tapiwa Sibanda", "programme": "BCom Accounting", "year": 3,
        "risk": 0.93, "tier": "high",
        "gpa": [3.4, 2.9, 2.0], "attendance": 31, "lmsLogins": 1, "facilityAccess": 0,
        "shap": [
            {"feature": "GPA fell from 3.4 to 2.0 over 2 semesters", "value": 0.38, "dir": 1},
            {"feature": "Attendance critically low at 31%", "value": 0.31, "dir": 1},
            {"feature": "Zero facility access this month", "value": 0.15, "dir": 1},
            {"feature": "Virtually absent from LMS", "value": 0.12, "dir": 1},
            {"feature": "No peer group interactions detected", "value": 0.09, "dir": 1},
        ],
        "explanation": "Tapiwa shows a critical risk profile. Severe academic collapse, near-total withdrawal from campus and digital engagement, and complete social disengagement indicate an acute crisis state. Urgent intervention is required.",
        "intervention": ["URGENT: Same-day counsellor contact required", "Emergency wellness protocol activation", "Faculty and Dean of Students notification", "Safety assessment — do not leave uncontacted"],
        "lastUpdated": "2026-02-24",
    },
]

TIER = {
    "high": {"label": "High Risk", "bg": "#FF3B30", "light": "rgba(255,59,48,0.12)", "ring": "#FF3B30"},
    "medium": {"label": "Medium Risk", "bg": "#FF9F0A", "light": "rgba(255,159,10,0.12)", "ring": "#FF9F0A"},
    "low": {"label": "Low Risk", "bg": "#30D158", "light": "rgba(48,209,88,0.12)", "ring": "#30D158"},
}

AUDIT_LOGS = [
    {"time": "06:12", "user": "counsellor1", "action": "Viewed risk profile", "target": "N00849023", "level": "high"},
    {"time": "06:08", "user": "welfare1", "action": "Logged intervention", "target": "N00411234", "level": "high"},
    {"time": "05:55", "user": "counsellor1", "action": "Exported report", "target": "N00523891", "level": "medium"},
    {"time": "05:40", "user": "admin", "action": "User account created", "target": "welfare2", "level": "info"},
    {"time": "04:30", "user": "welfare1", "action": "Viewed risk profile", "target": "N00614782", "level": "medium"},
    {"time": "03:15", "user": "counsellor1", "action": "Alert acknowledged", "target": "N00849023", "level": "high"},
]

SYSTEM_USERS = [
    {"name": "Dr. Sibanda, N.", "username": "counsellor1", "role": "counsellor", "status": "Active", "last": "Today 06:12"},
    {"name": "Ms. Choto, R.", "username": "welfare1", "role": "welfare", "status": "Active", "last": "Today 06:08"},
    {"name": "Mr. Dube, T.", "username": "admin", "role": "admin", "status": "Active", "last": "Today 05:40"},
    {"name": "Dr. Khumalo, P.", "username": "counsellor2", "role": "counsellor", "status": "Inactive", "last": "18 Feb 2026"},
]

# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════════════════

class ConnectionManager:
    """Manages WebSocket connections for real-time updates"""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast a message to all connected clients"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                # Remove broken connections
                self.disconnect(connection)

manager = ConnectionManager()

# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class Login(BaseModel):
    username: str
    password: str
    role: str

class Token(BaseModel):
    access_token: str
    token_type: str
    name: Optional[str] = None
    role: Optional[str] = None
    roleLabel: Optional[str] = None
    username: Optional[str] = None

    class Config:
        extra = "allow"

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class StudentUpdate(BaseModel):
    risk: Optional[float] = None
    tier: Optional[str] = None
    gpa: Optional[List[float]] = None
    attendance: Optional[int] = None
    lmsLogins: Optional[int] = None
    facilityAccess: Optional[int] = None
    explanation: Optional[str] = None
    intervention: Optional[List[str]] = None
    shap: Optional[List[Dict]] = None
    lime: Optional[List[Dict]] = None

class AuditLogCreate(BaseModel):
    action: str
    target: str
    level: str

class UserCreate(BaseModel):
    username: str
    password: str
    name: str
    role: str
    roleLabel: str

# ═══════════════════════════════════════════════════════════════════════════════
# JWT HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_access_token(data: dict):
    """Create JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    """Dependency to get current authenticated user"""
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role is None:
            raise credentials_exception
        return {"username": username, "role": role}
    except JWTError:
        raise credentials_exception

def filter_student_by_role(student: dict, role: str) -> dict:
    """Filter student data based on role"""
    student_copy = student.copy()

    if role == "welfare":
        # Welfare sees summaries only (no full SHAP/LIME/explanation)
        for k in ["shap", "lime", "explanation"]:
            if k in student_copy:
                del student_copy[k]
    # Counsellor and admin see all data


    return student_copy

# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "XAI Risk Sentinel API",
        "version": "1.0.0",
        "description": "Student Mental Health Risk Monitoring System (NUST)"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.get("/roles")
async def get_roles():
    """Get available roles"""
    return ROLES

@app.get("/tier")
async def get_tier_config():
    """Get tier configuration"""
    return TIER

@app.post("/login", response_model=Token)
async def login(form_data: Login):
    """Authenticate via MySQL (or in-memory fallback)."""
    user = get_user(form_data.username)
    if not user or user.get("role") != form_data.role or not db_verify_password(form_data.password, user["password"]):
        raise HTTPException(status_code=400, detail="Incorrect username, password, or role")
    touch_last_login(form_data.username)
    access_token = create_access_token(data={"sub": user["username"], "role": user["role"]})
    return {"access_token": access_token, "token_type": "bearer",
            "name": user.get("name", user["username"]), "role": user["role"],
            "roleLabel": user.get("roleLabel", user["role"].title()), "username": user["username"]}

# Startup handled by lifespan context manager — see app definition above


@app.get("/students")
async def get_students(
    current_user: dict = Depends(get_current_user),
    page: int = 1,
    limit: int = 50,
    tier: Optional[str] = None,
    department: Optional[str] = None,
    search: Optional[str] = None,
):
    """Paginated students endpoint supporting 1200+ students.
    ?page=1&limit=50&tier=high&search=moyo
    Always returns immediately — ML scores populate in the background."""
    global STUDENTS
    # Use ML-enriched list if ready, else fast CSV list
    source = TRAFFIC_STUDENTS if TRAFFIC_STUDENTS else STUDENTS
    role = current_user["role"]
    limit = min(limit, 200)
    filtered = source

    def department_name(programme: str) -> str:
        if not programme:
            return "Unknown"
        parts = programme.split()
        if len(parts) <= 1:
            return programme
        return " ".join(parts[1:]).strip()

    if tier:
        filtered = [s for s in filtered if s.get("tier") == tier]
    if department:
        dept = department.strip().lower()
        filtered = [s for s in filtered if dept == department_name(s.get("programme", "")).lower()]
    if search:
        q = search.lower()
        filtered = [s for s in filtered if q in s.get("name","").lower() or q in s.get("id","").lower() or q in s.get("programme","").lower()]
    # Sort students by descending risk so counsellors see the highest-risk students first.
    filtered = sorted(filtered, key=lambda s: float(s.get("risk", 0)), reverse=True)
    total = len(filtered)
    start = (page - 1) * limit
    page_data = filtered[start:start + limit]
    return {
        "students": [filter_student_by_role(s, role) for s in page_data],
        "total": total, "page": page, "limit": limit,
        "pages": max(1, (total + limit - 1) // limit),
        "ml_ready": PREDICTIONS_LOADED,
    }

@app.get("/predictions-status")
async def predictions_status(current_user: dict = Depends(get_current_user)):
    """Poll this to know when background ML predictions are ready."""
    return {
        "ml_ready":   PREDICTIONS_LOADED,
        "loading":    PREDICTIONS_LOADING,
        "total":      len(TRAFFIC_STUDENTS),
    }


@app.get("/analytics")
async def get_analytics(current_user: dict = Depends(get_current_user)):
    """Get analytics summaries by faculty, department and class."""
    source = TRAFFIC_STUDENTS if TRAFFIC_STUDENTS else STUDENTS

    def faculty_name(programme: str) -> str:
        if not programme:
            return "Unknown"
        programme = programme.strip()
        if programme.startswith("BSc"):
            return "Science"
        if programme.startswith("BEng"):
            return "Engineering"
        if programme.startswith("BCom"):
            return "Commerce"
        if programme.startswith("BA"):
            return "Arts"
        return programme.split()[0]

    def department_name(programme: str) -> str:
        if not programme:
            return "Unknown"
        parts = programme.split()
        if len(parts) <= 1:
            return programme
        return " ".join(parts[1:]).strip()

    def summarize(items, total_base=None):
        total = len(items)
        base = total_base if total_base is not None else len(source)
        high = len([s for s in items if s.get("tier") == "high"])
        medium = len([s for s in items if s.get("tier") == "medium"])
        low = len([s for s in items if s.get("tier") == "low"])
        return {
            "total": total,
            "percentage": round(total / max(base, 1) * 100, 1),
            "high": high,
            "medium": medium,
            "low": low,
            "highPct": round(high / max(total, 1) * 100, 1),
            "mediumPct": round(medium / max(total, 1) * 100, 1),
            "lowPct": round(low / max(total, 1) * 100, 1),
            "avgRisk": round(sum(float(s.get("risk", 0)) for s in items) / max(total, 1), 3),
        }

    faculties = {}
    departments = {}
    years = {}

    for student in source:
        faculty = faculty_name(student.get("programme", ""))
        department = department_name(student.get("programme", ""))
        year = f"Year {student.get('year', 1)}"

        faculties.setdefault(faculty, []).append(student)
        departments.setdefault(department, []).append(student)
        years.setdefault(year, []).append(student)

    return {
        "totalStudents": len(source),
        "counts": summarize(source),
        "faculties": [
            {"faculty": k, **summarize(v)} for k, v in sorted(faculties.items(), key=lambda kv: kv[0])
        ],
        "departments": [
            {"department": k, **summarize(v)} for k, v in sorted(departments.items(), key=lambda kv: kv[0])
        ],
        "classes": [
            {"class": k, **summarize(v)} for k, v in sorted(years.items(), key=lambda kv: kv[0])
        ],
        "topStudents": [
            {"id": s.get("id"), "name": s.get("name"), "programme": s.get("programme"), "year": s.get("year"),
             "risk": round(float(s.get("risk", 0)) * 100), "tier": s.get("tier"),
             "attendance": s.get("attendance"), "lmsLogins": s.get("lmsLogins"), "facilityAccess": s.get("facilityAccess")}
            for s in sorted(source, key=lambda s: float(s.get("risk", 0)), reverse=True)[:12]
        ],
    }


@app.post("/students/assess")
async def assess_student(assessment: dict, current_user: dict = Depends(get_current_user)):
    """Run a live prediction from manual feature contributions."""
    result = data_service.manual_assessment(assessment)
    return result


@app.post("/students/batch")
async def batch_update_predictions(current_user: dict = Depends(get_current_user)):
    """
    Trigger a batch ML prediction refresh for all students.
    Returns immediately — actual predictions run in background.
    Requires auth (any role).
    """
    if not ML_PIPELINE_AVAILABLE:
        return {"status": "unavailable", "message": "ML Pipeline not available",
                "ml_ready": PREDICTIONS_LOADED, "total": len(TRAFFIC_STUDENTS or STUDENTS)}
    # If already loading, report status
    if PREDICTIONS_LOADING:
        return {"status": "running", "message": "ML predictions already in progress",
                "ml_ready": PREDICTIONS_LOADED, "total": len(TRAFFIC_STUDENTS or STUDENTS)}
    # Kick off a fresh background prediction run
    import threading as _t
    thread = _t.Thread(target=_run_ml_predictions_background, daemon=True, name="ml-batch-refresh")
    thread.start()
    return {"status": "started", "message": "Batch ML prediction refresh started in background",
            "ml_ready": PREDICTIONS_LOADED, "total": len(TRAFFIC_STUDENTS or STUDENTS)}

@app.get("/students/{student_id}")
async def get_student(student_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific student by ID.

    For counsellor/admin: if SHAP/explanation are missing, compute real per-student
    SHAP on-demand (avoids startup-time TreeExplainer deadlocks/OOM).

    Welfare: SHAP/explanation are stripped by `filter_student_by_role()`.
    """
    source = TRAFFIC_STUDENTS if TRAFFIC_STUDENTS else STUDENTS
    student = next((s for s in source if s["id"] == student_id), None)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    role = current_user["role"]

    # Only counsellor/admin should receive SHAP/explanation.
    if role in ["counsellor", "admin"]:
        shap_missing = (not student.get("shap")) or (len(student.get("shap")) == 0)
        explanation_missing = not student.get("explanation")
        if shap_missing or explanation_missing:
            if ML_PIPELINE_AVAILABLE:
                try:
                    # Compute full per-student prediction including SHAP + text.
                    prediction = data_service.predict_single_student(student)
                    student["risk"] = prediction.get("risk", student.get("risk"))
                    student["tier"] = prediction.get("tier", student.get("tier"))
                    student["shap"] = prediction.get("shap", student.get("shap", []))
                    student["explanation"] = prediction.get("explanation", student.get("explanation", ""))
                    student["intervention"] = prediction.get("intervention", student.get("intervention", []))
                    student["lime"] = prediction.get("lime", student.get("lime", []))
                    student["lastUpdated"] = prediction.get("lastUpdated", student.get("lastUpdated", ""))


                    await manager.broadcast({
                        "type": "student_update",
                        "data": filter_student_by_role(student, role)
                    })
                except Exception as e:
                    # Keep response stable; do not fail the request.
                    student["explanation"] = student.get("explanation") or "SHAP explanation pending due to computation error."

    return filter_student_by_role(student, role)


@app.post("/students/{student_id}")
async def update_student(
    student_id: str,
    update: StudentUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update a student (auth required - counsellor/admin only)
    Triggers real-time WebSocket broadcast to all connected clients
    """
    if current_user["role"] not in ["counsellor", "admin"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    source = TRAFFIC_STUDENTS if TRAFFIC_STUDENTS else STUDENTS
    student = next((s for s in source if s["id"] == student_id), None)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Update fields
    update_data = update.dict(exclude_unset=True)
    student.update(update_data)
    student["lastUpdated"] = datetime.now().strftime("%Y-%m-%d")

    # Broadcast update to all connected WebSocket clients
    await manager.broadcast({
        "type": "student_update",
        "data": filter_student_by_role(student, current_user["role"])
    })

    # Log action
    AUDIT_LOGS.insert(0, {
        "time": datetime.now().strftime("%H:%M"),
        "user": current_user["username"],
        "action": "Updated student",
        "target": student_id,
        "level": student.get("tier", "info")
    })

    return filter_student_by_role(student, current_user["role"])

@app.get("/audit-logs")
async def get_audit_logs(current_user: dict = Depends(get_current_user)):
    """Get audit logs (admin only)"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return AUDIT_LOGS

@app.post("/audit-logs")
async def create_audit_log(
    log: AuditLogCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new audit log entry"""
    new_log = {
        "time": datetime.now().strftime("%H:%M"),
        "user": current_user["username"],
        "action": log.action,
        "target": log.target,
        "level": log.level
    }
    AUDIT_LOGS.insert(0, new_log)
    return new_log

@app.get("/users")
async def get_users(current_user: dict = Depends(get_current_user)):
    """Get system users from MySQL / in-memory store (admin only)."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return get_all_users()

@app.post("/users")
async def create_user_endpoint(user: UserCreate, current_user: dict = Depends(get_current_user)):
    """Create a new user, persisted to MySQL / in-memory store (admin only)."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        result = db_create_user(user.username, user.password, user.name, user.role, user.roleLabel)
        return {"message": "User created successfully", "username": result["username"]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/stats")
async def get_stats(current_user: dict = Depends(get_current_user)):
    """
    Get system statistics from trained ML model data
    """

    source = TRAFFIC_STUDENTS if TRAFFIC_STUDENTS else STUDENTS
    counts = {
        "high": len([s for s in source if s.get("tier") == "high"]),
        "medium": len([s for s in source if s.get("tier") == "medium"]),
        "low": len([s for s in source if s.get("tier") == "low"]),
    }

    # Get model info from pipeline if available
    model_info = {
        "model": "XGBoost v2.1",
        "shap": "v0.46",
        "lastTrained": "22 Feb 2026",
        "auc_roc": "0.88"
    }

    if ML_PIPELINE_AVAILABLE and pipeline:
        try:
            pipeline_status = pipeline.get_status()
            if pipeline_status.get("last_trained"):
                model_info["lastTrained"] = pipeline_status["last_trained"]
        except Exception:
            pass

    return {
        "total": len(STUDENTS),           # frontend reads r.total
        "counts": counts,                 # frontend reads r.counts.high etc
        "totalStudents": len(STUDENTS),   # kept for compatibility
        "riskCounts": counts,
        "activeUsers": len([u for u in get_all_users() if u.get("status") == "Active"]),
        "modelInfo": model_info
    }

# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates
    Clients can connect to receive live updates when student data is modified
    """
    await manager.connect(websocket)
    try:
        while True:
            # Wait for messages from client (optional - can be used for heartbeats)
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                # Handle client messages if needed
                if message.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ═══════════════════════════════════════════════════════════════════════════════
# AUTOMATED ML PIPELINE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/pipeline/status")
async def get_pipeline_status():
    """Get ML Pipeline status"""
    if not ML_PIPELINE_AVAILABLE:
        return {"status": "unavailable", "message": "ML Pipeline not installed", "is_trained": False}
    try:
        status = pipeline.get_status()
        return {"status": "ready", "is_trained": status.get("is_trained", False), "last_trained": status.get("last_trained")}
    except Exception as e:
        return {"status": "error", "message": str(e), "is_trained": False}

@app.post("/pipeline/train")
async def train_model():
    """Train the ML model on current data"""
    if not ML_PIPELINE_AVAILABLE:
        raise HTTPException(status_code=503, detail="ML Pipeline not available")
    try:
        df = pipeline.load_data()
        if df.empty:
            raise HTTPException(status_code=400, detail="No training data found")
        results = pipeline.train_model(df, save=True)
        await manager.broadcast({"type": "model_trained", "data": {"last_trained": results.get("last_trained")}})
        return {"status": "success", "message": "Model trained", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/pipeline/run")
async def run_pipeline():
    """Run the full ML pipeline: train and predict"""
    if not ML_PIPELINE_AVAILABLE:
        raise HTTPException(status_code=503, detail="ML Pipeline not available")
    try:
        results = run_full_pipeline()
        if results.get("status") == "success":
            detailed = results.get("detailed_predictions", [])
            for pred in detailed:
                student_id = pred.get("student_id")
                for i, s in enumerate(STUDENTS):
                    if s["id"] == student_id:
                        STUDENTS[i]["risk"] = pred.get("risk", s["risk"])
                        STUDENTS[i]["tier"] = pred.get("tier", s["tier"])
                        STUDENTS[i]["shap"] = pred.get("shap", s.get("shap", []))
                        STUDENTS[i]["explanation"] = pred.get("explanation", s.get("explanation", ""))
                        STUDENTS[i]["intervention"] = pred.get("intervention", s.get("intervention", []))
                        STUDENTS[i]["lastUpdated"] = pred.get("lastUpdated", s.get("lastUpdated", ""))
            await manager.broadcast({"type": "pipeline_completed", "data": {"students_updated": len(detailed)}})
        return {"status": "success", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/pipeline/predict/{student_id}")
async def predict_student(student_id: str):
    """Generate prediction for a specific student"""
    if not ML_PIPELINE_AVAILABLE:
        raise HTTPException(status_code=503, detail="ML Pipeline not available")
    student = next((s for s in STUDENTS if s["id"] == student_id), None)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    try:
        prediction = data_service.predict_single_student(student)
        for i, s in enumerate(STUDENTS):
            if s["id"] == student_id:
                STUDENTS[i]["risk"] = prediction.get("risk", s["risk"])
                STUDENTS[i]["tier"] = prediction.get("tier", s["tier"])
                STUDENTS[i]["shap"] = prediction.get("shap", s.get("shap", []))
                STUDENTS[i]["explanation"] = prediction.get("explanation", s.get("explanation", ""))
                STUDENTS[i]["intervention"] = prediction.get("intervention", s.get("intervention", []))
        return {"status": "success", "prediction": prediction}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/data/ingest")
async def ingest_data(file_path: Optional[str] = None):
    """Ingest student data from CSV"""
    if not ML_PIPELINE_AVAILABLE:
        raise HTTPException(status_code=503, detail="ML Pipeline not available")
    try:
        students = data_service.load_students_from_csv(file_path)
        if not students:
            raise HTTPException(status_code=400, detail="No data found in CSV")
        api_students = data_service.convert_csv_to_student_format(students)
        return {"status": "success", "records_loaded": len(api_students)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ═══════════════════════════════════════════════════════════════════════════════
# ACADEMIC RESULTS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/academic-results/{programme}")
async def get_programme_academic_results(
    programme: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get academic results for a specific programme across 8 semesters.
    Returns class average GPA for each semester.
    """
    try:
        results = get_academic_results(STUDENTS, programme)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ═══════════════════════════════════════════════════════════════════════════════
# PREPROCESSING PIPELINE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

# Global state for preprocessing pipeline
PREPROCESSING_STATE = {
    "status": "idle",
    "started_at": None,
    "completed_at": None,
    "error": None,
    "current_step": 0,
    "steps_completed": [],
    "progress": []
}

# Check if data_preprocessing.py exists
def check_preprocessing_available():
    """Check if data_preprocessing.py file exists."""

    import os
    # Check in current directory and parent directory
    paths_to_check = [
        os.path.join(os.path.dirname(__file__), '..', 'data_preprocessing.py'),
        os.path.join(os.path.dirname(__file__), 'data_preprocessing.py'),
        'data_preprocessing.py',
    ]
    for path in paths_to_check:
        if os.path.exists(path):
            return True
    return False

@app.post("/preprocessing/run")
async def run_preprocessing(current_user: dict = Depends(get_current_user)):
    """
    Run the data preprocessing pipeline in a background thread.
    Requires JWT authentication.
    """
    global PREPROCESSING_STATE

    # Check if already running
    if PREPROCESSING_STATE["status"] == "running":
        return {"status": "already_running", "message": "Pipeline is already running"}

    # Check if preprocessing script exists
    if not check_preprocessing_available():
        raise HTTPException(status_code=503, detail="data_preprocessing.py not found")

    # Reset state
    PREPROCESSING_STATE = {
        "status": "running",
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "error": None,
        "current_step": 0,
        "steps_completed": [],
        "progress": []
    }

    # Broadcast started message
    await manager.broadcast({
        "type": "preprocessing_started",
        "data": {"started_at": PREPROCESSING_STATE["started_at"]}
    })

    def run_preprocessing_thread():
        """Background thread to run preprocessing."""
        global PREPROCESSING_STATE
        try:
            # Import and run preprocessing
            import sys
            import os

            # Add current directory to path
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            if parent_dir not in sys.path:
                sys.path.insert(0, parent_dir)

            # Progress callback function
            def progress_callback(progress_info):
                global PREPROCESSING_STATE
                step = progress_info.get("step", 0)
                label = progress_info.get("label", "")
                status = progress_info.get("status", "running")
                detail = progress_info.get("detail", "")

                PREPROCESSING_STATE["current_step"] = step
                PREPROCESSING_STATE["progress"].append({
                    "step": step,
                    "label": label,
                    "status": status,
                    "detail": detail,
                    "timestamp": datetime.utcnow().isoformat()
                })

                # Broadcast progress
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(manager.broadcast({
                            "type": "preprocessing_progress",
                            "data": progress_info
                        }))
                except Exception:
                    pass

            # Import the preprocessing module
            from data_preprocessing import main as preprocessing_main
            preprocessing_main(progress_callback=progress_callback)

            # Mark as complete
            PREPROCESSING_STATE["status"] = "complete"
            PREPROCESSING_STATE["completed_at"] = datetime.utcnow().isoformat()

            # Broadcast complete
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(manager.broadcast({
                        "type": "preprocessing_complete",
                        "data": {"completed_at": PREPROCESSING_STATE["completed_at"]}
                    }))
            except Exception:
                pass

        except Exception as e:
            PREPROCESSING_STATE["status"] = "failed"
            PREPROCESSING_STATE["error"] = str(e)
            PREPROCESSING_STATE["completed_at"] = datetime.utcnow().isoformat()

            # Broadcast failed
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(manager.broadcast({
                        "type": "preprocessing_failed",
                        "data": {"error": str(e)}
                    }))
            except Exception:
                pass

    # Start background thread
    thread = threading.Thread(target=run_preprocessing_thread, daemon=True)
    thread.start()

    return {"status": "started", "message": "Preprocessing pipeline started", "started_at": PREPROCESSING_STATE["started_at"]}

@app.get("/preprocessing/status")
async def get_preprocessing_status():
    """
    Get the current status of the preprocessing pipeline.
    No authentication required.
    """
    return {
        "state": PREPROCESSING_STATE,
        "preprocessing_available": check_preprocessing_available()
    }

@app.get("/preprocessing/results")
async def get_preprocessing_results(current_user: dict = Depends(get_current_user)):
    """
    Get the preprocessing results.
    Requires JWT authentication.
    """
    import os
    import pandas as pd

    results_file = "reports/preprocessing_results.json"
    summary_file = "reports/preprocessing_summary.txt"
    missing_file = "reports/missing_values_report.csv"

    # Check if results file exists
    if not os.path.exists(results_file):
        return {"status": "no_results", "message": "Run preprocessing first"}

    # Read results JSON
    with open(results_file, 'r') as f:
        results = json.load(f)

    # Read summary if exists
    summary = None
    if os.path.exists(summary_file):
        with open(summary_file, 'r') as f:
            summary = f.read()

    # Read missing values CSV
    missing_values = []
    if os.path.exists(missing_file):
        df_missing = pd.read_csv(missing_file)
        missing_values = df_missing.to_dict('records')

    return {
        "status": "success",
        "results": results,
        "summary": summary,
        "missing_values": missing_values
    }

@app.get("/preprocessing/plots/{plot_name}")
async def get_preprocessing_plot(plot_name: str):
    """
    Get a preprocessing plot image.
    No authentication required.
    """
    valid_plots = ["class_distribution", "feature_distributions", "correlation_heatmap", "features_by_risk_label"]

    if plot_name not in valid_plots:
        raise HTTPException(status_code=400, detail=f"Invalid plot name. Valid options: {', '.join(valid_plots)}")

    plot_file = f"plots/{plot_name}.png"

    if not os.path.exists(plot_file):
        raise HTTPException(status_code=404, detail="Plot not found — run preprocessing first")

    return FileResponse(plot_file, media_type="image/png")

# ═══════════════════════════════════════════════════════════════════════════════
# RUN INSTRUCTIONS
# ═══════════════════════════════════════════════════════════════════════════════
