"""
XAI Risk Sentinel - db.py
User auth layer: MySQL when available, in-memory fallback always works.
Hardcoded seed users are written to MySQL on first init.
"""

import os
import bcrypt as _bcrypt
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

SEED_USERS = [
    {"username": "counsellor1", "password": "Care@2026",    "name": "Dr. Sibanda, N.", "role": "counsellor", "roleLabel": "Mental Health Counsellor"},
    {"username": "welfare1",    "password": "Welfare@2026", "name": "Ms. Choto, R.",   "role": "welfare",    "roleLabel": "Student Welfare Officer"},
    {"username": "admin",       "password": "Admin@2026",   "name": "Mr. Dube, T.",    "role": "admin",      "roleLabel": "System Administrator"},
]

# In-memory store (always populated as fallback)
_MEM: dict = {}

def _hash(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()

def _build_mem():
    for u in SEED_USERS:
        _MEM[u["username"]] = {**u, "password": _hash(u["password"]), "status": "Active", "last_login": None}

_build_mem()

_USE_MYSQL = False
_engine    = None

def _try_mysql():
    global _USE_MYSQL, _engine
    try:
        from sqlalchemy import create_engine, text
        host = os.getenv("DB_HOST", "localhost")
        user = os.getenv("DB_USER", "root")
        pw   = os.getenv("DB_PASSWORD", "")
        db   = os.getenv("DB_NAME", "xai_student_risk_db")
        port = int(os.getenv("DB_PORT", 3306))
        eng  = create_engine(f"mysql+pymysql://{user}:{pw}@{host}:{port}/{db}", pool_pre_ping=True, pool_recycle=1800, echo=False)
        with eng.connect() as c:
            c.execute(text("SELECT 1"))
        _engine = eng
        _USE_MYSQL = True
        print("db.py: Connected to MySQL")
    except Exception as e:
        print(f"db.py: MySQL unavailable ({e}) — using in-memory store")
        _USE_MYSQL = False

def _ensure_table():
    if not _USE_MYSQL or _engine is None:
        return
    from sqlalchemy import text
    with _engine.begin() as c:
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS system_users (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                username   VARCHAR(80)  NOT NULL UNIQUE,
                password   VARCHAR(255) NOT NULL,
                name       VARCHAR(120) NOT NULL,
                role       VARCHAR(40)  NOT NULL,
                role_label VARCHAR(120) NOT NULL DEFAULT '',
                status     VARCHAR(20)  NOT NULL DEFAULT 'Active',
                last_login DATETIME     NULL,
                created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))
        count = c.execute(text("SELECT COUNT(*) FROM system_users")).scalar()
        if count == 0:
            for u in SEED_USERS:
                c.execute(text("""
                    INSERT INTO system_users (username, password, name, role, role_label, status)
                    VALUES (:un, :pw, :nm, :rl, :rll, 'Active')
                """), {"un": u["username"], "pw": _hash(u["password"]),
                       "nm": u["name"], "rl": u["role"], "rll": u["roleLabel"]})
            print("db.py: Seeded default users into MySQL")

def init_db():
    _try_mysql()
    _ensure_table()

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False

def get_user(username):
    if _USE_MYSQL and _engine:
        try:
            from sqlalchemy import text
            with _engine.connect() as c:
                row = c.execute(text("SELECT * FROM system_users WHERE username=:u"), {"u": username}).mappings().first()
            if row:
                return {"username": row["username"], "password": row["password"], "name": row["name"],
                        "role": row["role"], "roleLabel": row["role_label"], "status": row["status"],
                        "last_login": str(row["last_login"]) if row["last_login"] else None}
        except Exception as e:
            print(f"db.get_user error: {e}")
    return _MEM.get(username)

def get_all_users():
    if _USE_MYSQL and _engine:
        try:
            from sqlalchemy import text
            with _engine.connect() as c:
                rows = c.execute(text("SELECT username,name,role,role_label,status,last_login FROM system_users")).mappings().all()
            return [{"username": r["username"], "name": r["name"], "role": r["role"],
                     "roleLabel": r["role_label"], "status": r["status"],
                     "last": str(r["last_login"])[:16] if r["last_login"] else "Never"} for r in rows]
        except Exception as e:
            print(f"db.get_all_users error: {e}")
    return [{"username": u["username"], "name": u["name"], "role": u["role"],
             "roleLabel": u["roleLabel"], "status": u["status"],
             "last": u["last_login"] or "Never"} for u in _MEM.values()]

def create_user(username, password, name, role, role_label):
    hashed = _hash(password)
    if _USE_MYSQL and _engine:
        try:
            from sqlalchemy import text
            with _engine.begin() as c:
                c.execute(text("""
                    INSERT INTO system_users (username,password,name,role,role_label,status)
                    VALUES (:un,:pw,:nm,:rl,:rll,'Active')
                """), {"un": username, "pw": hashed, "nm": name, "rl": role, "rll": role_label})
        except Exception as e:
            if "Duplicate" in str(e) or "unique" in str(e).lower():
                raise ValueError(f"Username '{username}' already exists")
            raise
    if username in _MEM:
        raise ValueError(f"Username '{username}' already exists")
    _MEM[username] = {"username": username, "password": hashed, "name": name,
                      "role": role, "roleLabel": role_label, "status": "Active", "last_login": None}
    return {"username": username, "name": name, "role": role, "roleLabel": role_label}

def touch_last_login(username):
    now = datetime.utcnow()
    if _USE_MYSQL and _engine:
        try:
            from sqlalchemy import text
            with _engine.begin() as c:
                c.execute(text("UPDATE system_users SET last_login=:now WHERE username=:u"), {"now": now, "u": username})
        except Exception as e:
            print(f"db.touch_last_login error: {e}")
    if username in _MEM:
        _MEM[username]["last_login"] = now.strftime("%Y-%m-%d %H:%M")
