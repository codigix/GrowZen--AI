"""The platform's own login: seeded admin, sign in/out, user management, password hashing."""
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import SessionLocal
from app.main import app
from app.routers.auth import seed_admin
from app.services.passwords import hash_password, verify_password


def test_password_hashing():
    h = hash_password("s3cret-pass")
    assert h.startswith("scrypt$") and verify_password("s3cret-pass", h) and not verify_password("wrong", h)
    assert hash_password("s3cret-pass") != h  # salted


def test_login_flow():
    s = get_settings()
    s.admin_email, s.admin_password, s.admin_name = "admin@example.in", "admin-pass-123", "Owner"
    db = SessionLocal()
    seed_admin(db, s)
    seed_admin(db, s)  # second start: no duplicate
    db.close()

    c = TestClient(app)
    assert c.get("/api/v1/me").status_code == 401
    assert c.post("/api/v1/auth/login", json={"email": "admin@example.in", "password": "nope"}).status_code == 401
    r = c.post("/api/v1/auth/login", json={"email": "ADMIN@example.in", "password": "admin-pass-123"})
    assert r.status_code == 200 and "password_hash" not in r.json()
    me = c.get("/api/v1/me").json()
    assert me["name"] == "Owner" and me["is_admin"] and me["source"] == "seo"
    assert c.get("/api/v1/businesses").status_code == 200

    made = c.post("/api/v1/users", json={"email": "editor@example.in", "name": "Ed", "password": "editor-pass-1"})
    assert made.status_code == 201 and made.json()["role"] == "editor"
    assert len(c.get("/api/v1/users").json()) == 2

    editor = TestClient(app)
    editor.post("/api/v1/auth/login", json={"email": "editor@example.in", "password": "editor-pass-1"})
    assert editor.get("/api/v1/users").status_code == 403  # admins only

    c.post("/api/v1/auth/logout")
    assert c.get("/api/v1/me").status_code == 401
