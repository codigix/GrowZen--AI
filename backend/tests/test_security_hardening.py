"""Hardening: security headers, cross-site request check, docs off in production, login lockout and timing, password policy,
sessions that die with the password, one-use reset tokens that are never returned, start-up guards."""
import time

import jwt
import pytest
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.testclient import TestClient

from app import security_headers as sh
from app.config import Settings, get_settings
from app.db import SessionLocal
from app.main import app
from app.models import ActivityLog
from app.routers import auth as auth_router
from test_security import login, user


@pytest.fixture(autouse=True)
def reset_throttle():
    auth_router._failures.clear()
    yield
    auth_router._failures.clear()


def _settings(**kw):
    return Settings(_env_file=None, **{"secret_key": "k" * 48, **kw})


def _mini(settings, html_paths=()):
    """A tiny app with the same middlewares: its routes are ours to shape."""
    a = FastAPI(**sh.docs_kwargs(settings))
    sh.install(a, settings)

    @a.post("/api/v1/thing")
    def thing():
        return {"ok": True}

    @a.post("/api/v1/public/review/abc/suggest")
    def public():
        return {"ok": True}

    @a.get("/api/v1/report.html")
    def report():
        return HTMLResponse("<html><script>1</script></html>")

    @a.get("/")
    def index():
        return HTMLResponse("<html></html>")

    return a


# ── headers ──────────────────────────────────────────────────────────────────
def test_every_response_carries_the_security_headers():
    c = TestClient(app)
    r = c.get("/api/v1/me")  # a 401: the headers are on errors too
    assert r.status_code == 401
    h = r.headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and h["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in h["permissions-policy"] and "geolocation=()" in h["permissions-policy"] and h["cross-origin-opener-policy"] == "same-origin"
    assert h["content-security-policy"] == sh.API_CSP and "frame-ancestors 'none'" in h["content-security-policy"]
    assert "strict-transport-security" not in h  # plain http


def test_hsts_only_over_https():
    r = TestClient(app, base_url="https://testserver").get("/api/v1/me")
    assert "max-age=" in r.headers["strict-transport-security"]


def test_the_page_gets_the_app_policy_and_api_html_only_the_framing_rules():
    c = TestClient(_mini(_settings()))
    page = c.get("/").headers["content-security-policy"]
    assert "script-src 'self'" in page and "'unsafe-eval'" not in page and "frame-ancestors 'none'" in page and "img-src 'self' data: blob: https:" in page
    assert "fonts.googleapis.com" in page and "fonts.gstatic.com" in page and "object-src 'none'" in page
    assert c.get("/api/v1/report.html").headers["content-security-policy"] == sh.API_HTML_CSP  # a generated report keeps its own scripts
    assert c.get("/docs").status_code == 200  # development keeps the interactive docs


def test_docs_and_openapi_are_off_in_production():
    assert sh.docs_kwargs(_settings(environment="production")) == {"docs_url": None, "redoc_url": None, "openapi_url": None}
    prod = TestClient(_mini(_settings(environment="production")))
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert prod.get(path).status_code == 404
    assert sh.docs_kwargs(_settings(environment="development")) == {}


# ── cross-site requests ─────────────────────────────────────────────────────
def test_a_cross_site_post_is_refused_and_a_same_site_one_is_not():
    c = TestClient(_mini(_settings(cors_origins="https://app.example.in", frontend_url="https://app.example.in")))
    assert c.post("/api/v1/thing", headers={"origin": "https://evil.example"}).status_code == 403
    assert c.post("/api/v1/thing", headers={"origin": "null"}).status_code == 403
    assert c.post("/api/v1/thing", headers={"referer": "https://evil.example/page"}).status_code == 403  # no Origin: the Referer is read
    assert c.post("/api/v1/thing", headers={"origin": "https://app.example.in"}).status_code == 200  # the configured frontend
    assert c.post("/api/v1/thing", headers={"origin": "http://testserver"}).status_code == 200  # same origin as the Host header
    assert c.post("/api/v1/thing").status_code == 200  # no browser headers: curl, servers
    assert c.get("/api/v1/report.html", headers={"origin": "https://evil.example"}).status_code == 200  # reads are not mutations
    assert c.post("/api/v1/public/review/abc/suggest", headers={"origin": "https://evil.example"}).status_code == 200  # public, token-protected
    assert c.post("/api/v1/thing", headers={"origin": "https://evil.example"}).headers["x-frame-options"] == "DENY"  # the refusal is dressed too


def test_the_real_app_refuses_a_cross_site_post_with_a_session():
    user("csrf@x.in", "editor")
    c, r = login("csrf@x.in")
    assert r.status_code == 200
    assert c.post("/api/v1/auth/logout", headers={"origin": "https://evil.example"}).status_code == 403
    assert c.get("/api/v1/me").status_code == 200  # nothing happened
    assert c.post("/api/v1/auth/logout", headers={"origin": "http://localhost:3100"}).status_code == 200  # the configured frontend


# ── login ───────────────────────────────────────────────────────────────────
def test_five_wrong_passwords_lock_the_account_for_fifteen_minutes_then_it_opens(monkeypatch):
    user("lock@x.in", "editor", "a-long-enough-password")
    c = TestClient(app)
    for _ in range(5):
        assert c.post("/api/v1/auth/login", json={"email": "lock@x.in", "password": "wrong"}).status_code == 401
    r = c.post("/api/v1/auth/login", json={"email": "lock@x.in", "password": "a-long-enough-password"})
    assert r.status_code == 429 and "Try again in" in r.json()["detail"]  # even the right password waits
    now = time.time()
    monkeypatch.setattr(auth_router.time, "time", lambda: now + 16 * 60)
    assert c.post("/api/v1/auth/login", json={"email": "lock@x.in", "password": "a-long-enough-password"}).status_code == 200


def test_an_unknown_email_gets_the_same_answers_and_the_same_lockout():
    c = TestClient(app)
    codes = [c.post("/api/v1/auth/login", json={"email": "nobody@x.in", "password": "whatever-it-is"}) for _ in range(6)]
    assert [x.status_code for x in codes[:5]] == [401] * 5 and codes[5].status_code == 429
    assert codes[0].json() == {"detail": "Wrong email or password."}
    user("real@x.in", "editor")
    auth_router._failures.clear()
    assert c.post("/api/v1/auth/login", json={"email": "real@x.in", "password": "wrong-password-1"}).json() == codes[0].json()  # no hint which was wrong


def test_a_password_hash_is_checked_even_when_the_account_does_not_exist(monkeypatch):
    calls = []
    real = auth_router.verify_password
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: calls.append(h) or real(p, h))
    TestClient(app).post("/api/v1/auth/login", json={"email": "ghost@x.in", "password": "x"})
    assert len(calls) == 1  # the same work as for a real account: the time does not give the answer away


def test_one_address_cannot_try_many_accounts(monkeypatch):
    monkeypatch.setattr(get_settings(), "login_ip_max_failures", 6)
    c = TestClient(app)
    codes = [c.post("/api/v1/auth/login", json={"email": f"user{i}@x.in", "password": "wrong-password"}).status_code for i in range(8)]
    assert codes[:6] == [401] * 6 and codes[6] == 429


def test_sign_ins_are_written_to_the_audit_log_without_passwords():
    user("audit@x.in", "editor")
    c = TestClient(app)
    c.post("/api/v1/auth/login", json={"email": "audit@x.in", "password": "not-the-password"})
    c.post("/api/v1/auth/login", json={"email": "audit@x.in", "password": "a-long-enough-password"})
    db = SessionLocal()
    rows = [a for a in db.query(ActivityLog).filter(ActivityLog.action.in_(("login_failed", "login_ok"))).order_by(ActivityLog.id.desc()).limit(4)]
    db.close()
    mine = [a for a in rows if a.actor in ("audit@x.in", "audit")]
    assert {a.action for a in mine} == {"login_failed", "login_ok"} and all(a.detail.get("ip") for a in mine)
    assert "not-the-password" not in str([a.detail for a in rows]) and "a-long-enough-password" not in str([a.detail for a in rows])


# ── passwords ───────────────────────────────────────────────────────────────
def test_password_policy():
    from fastapi import HTTPException
    v = auth_router.validate_password
    for bad in ("short", "password123", "1234567890", "aaaaaaaaaaaa", "samuel@x.in", "samuel123456", "Samuel-2026", "x" * 201):
        with pytest.raises(HTTPException) as e:
            v(bad, "samuel@x.in")
        assert e.value.status_code == 400, bad
    v("a-long-enough-password", "samuel@x.in")
    v("correct horse battery staple", "samuel@x.in")


def test_new_and_changed_passwords_follow_the_policy():
    user("pol-admin@x.in", "admin")
    a, _ = login("pol-admin@x.in")
    assert a.post("/api/v1/users", json={"email": "weak@x.in", "name": "W", "password": "password123"}).status_code == 400
    assert a.post("/api/v1/users", json={"email": "ok@x.in", "name": "O", "password": "a-fine-new-passphrase"}).status_code == 201
    uid = a.get("/api/v1/users").json()
    target = next(u for u in uid if u["email"] == "ok@x.in")["id"]
    assert a.patch(f"/api/v1/users/{target}", json={"password": "qwertyuiop"}).status_code == 400
    assert a.post("/api/v1/auth/change-password", json={"current": "a-long-enough-password", "new": "pol-admin-2026"}).status_code == 400  # the email's name
    assert a.post("/api/v1/auth/change-password", json={"current": "a-long-enough-password", "new": "a-long-enough-password"}).status_code == 400  # unchanged
    assert a.post("/api/v1/auth/change-password", json={"current": "wrong-current-one", "new": "a-brand-new-passphrase"}).status_code == 403


# ── sessions and reset tokens ───────────────────────────────────────────────
def test_changing_the_password_ends_every_other_session_but_not_this_one():
    user("sess@x.in", "editor")
    one, _ = login("sess@x.in")
    two, _ = login("sess@x.in")
    assert one.get("/api/v1/me").status_code == 200 and two.get("/api/v1/me").status_code == 200
    assert one.post("/api/v1/auth/change-password", json={"current": "a-long-enough-password", "new": "a-better-passphrase-1"}).status_code == 200
    assert one.get("/api/v1/me").status_code == 200  # this one was re-issued
    assert two.get("/api/v1/me").status_code == 401  # the other one is gone
    assert login("sess@x.in", "a-better-passphrase-1")[1].status_code == 200


def test_a_session_from_before_the_hardening_has_no_fingerprint_and_is_refused():
    user("old@x.in", "editor")
    s = get_settings()
    from app.models import AppUser
    db = SessionLocal()
    uid = db.query(AppUser).filter_by(email="old@x.in").one().id
    db.close()
    c = TestClient(app)
    c.cookies.set(s.session_cookie, jwt.encode({"sub": str(uid), "kind": "seo", "exp": int(time.time()) + 600}, s.secret_key, algorithm="HS256"))
    assert c.get("/api/v1/me").status_code == 401


def test_the_cookies_are_httponly_lax_and_cleared_on_logout(monkeypatch):
    user("ck@x.in", "editor")
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"email": "ck@x.in", "password": "a-long-enough-password"})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie and "secure" not in cookie.replace("samesite", "")
    out = c.post("/api/v1/auth/logout").headers.get_list("set-cookie")
    assert any(h.lower().startswith("seo_session=") and ("max-age=0" in h.lower() or "expires=" in h.lower()) for h in out)
    monkeypatch.setattr(get_settings(), "cookie_secure", True)
    r = TestClient(app).post("/api/v1/auth/login", json={"email": "ck@x.in", "password": "a-long-enough-password"})
    assert "secure" in r.headers["set-cookie"].lower().replace("samesite", "")


def test_forgot_password_never_returns_the_token_or_says_whether_the_account_exists(monkeypatch):
    user("fp@x.in", "editor")
    sent = []
    monkeypatch.setattr(auth_router, "_send_reset", lambda to, name, token, settings: sent.append((to, token)))
    c = TestClient(app)
    known = c.post("/api/v1/auth/forgot-password", json={"email": "fp@x.in"})
    unknown = c.post("/api/v1/auth/forgot-password", json={"email": "nobody-here@x.in"})
    assert known.status_code == unknown.status_code == 200 and known.json() == unknown.json()
    assert "token" not in known.json() and not any(k in known.text.lower() for k in ("eyj", "dev_mode"))
    assert [s[0] for s in sent] == ["fp@x.in"]  # the token goes to the mailbox only
    token = sent[0][1]
    r = c.post("/api/v1/auth/reset-password", json={"token": token, "password": "password123"})
    assert r.status_code == 400  # the policy applies to a reset too
    assert c.post("/api/v1/auth/reset-password", json={"token": token, "password": "a-reset-passphrase-9"}).status_code == 200
    assert c.post("/api/v1/auth/reset-password", json={"token": token, "password": "another-passphrase-7"}).status_code == 400  # one use
    assert login("fp@x.in", "a-reset-passphrase-9")[1].status_code == 200
    assert c.post("/api/v1/auth/reset-password", json={"token": "garbage", "password": "a-reset-passphrase-9"}).json() == {"detail": "This reset link is invalid or has expired. Request a new one."}


def test_forgot_password_requests_are_limited():
    c = TestClient(app)
    codes = [c.post("/api/v1/auth/forgot-password", json={"email": "limit@x.in"}).status_code for _ in range(7)]
    assert codes[:4] == [200] * 4 and 429 in codes


# ── start-up guards ─────────────────────────────────────────────────────────
def test_the_server_refuses_to_start_with_a_weak_secret_key_or_wildcard_cors():
    for weak in ("change-me", "short-key", "x" * 31):
        with pytest.raises(RuntimeError, match="SECRET_KEY"):
            sh.startup_checks(_settings(secret_key=weak))
    sh.startup_checks(_settings(secret_key="x" * 32))
    sh.startup_checks(_settings(secret_key="change-me", allow_insecure_dev=True))  # a throw-away machine, on purpose
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        sh.startup_checks(_settings(cors_origins="*"))
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        sh.startup_checks(_settings(cors_origins="http://localhost:3100,*"))


def test_stored_google_tokens_need_a_valid_encryption_key():
    import test_gbp as g
    g.connection()  # a stored Google connection
    db = SessionLocal()
    try:
        with pytest.raises(RuntimeError, match="TOKEN_ENCRYPTION_KEY"):
            sh.check_encryption_key(db, _settings(token_encryption_key=""))
        with pytest.raises(RuntimeError, match="TOKEN_ENCRYPTION_KEY"):
            sh.check_encryption_key(db, _settings(token_encryption_key="not-a-fernet-key"))
        sh.check_encryption_key(db, get_settings())  # the suite's own valid key
    finally:
        db.close()
