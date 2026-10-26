"""Tests run on a throwaway SQLite database with no network: providers fall back to sample
data, PageSpeed and the crawler are stubbed, AI is off."""
import os
import tempfile
import time

_db = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_db}",
    "CRM_JWT_SECRET": "test-secret-0123456789-abcdefghijklmnop",
    "CRM_API_URL": "",
    "SCHEDULER_ENABLED": "false",
    "DEEPSEEK_API_KEY": "", "OPENAI_API_KEY": "", "GEMINI_API_KEY": "", "PERPLEXITY_API_KEY": "", "ANTHROPIC_API_KEY": "",
    "DATAFORSEO_LOGIN": "", "INTAKE_ALLOWED_SENDERS": "codigixinfotech.com", "INTAKE_WEBHOOK_TOKEN": "hook-token",
    "SMTP_HOST": "", "SECRET_KEY": "test-session-secret-0123456789-abcdef", "ADMIN_EMAIL": "", "ADMIN_PASSWORD": "",
})

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def schema():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def client(monkeypatch):
    # No network in tests: PageSpeed and the crawler return canned results.
    from app.services import crawler, pagespeed
    monkeypatch.setattr(pagespeed, "run", lambda url, strategy="mobile": {
        "url": url, "strategy": strategy, "scores": {"seo": 83, "performance": 54, "accessibility": 88, "best_practices": 92},
        "seo_checks": [{"id": "meta-description", "title": "Document does not have a meta description", "description": "Write one.", "status": "fail", "display_value": ""}],
        "metrics": {"lcp": "4.1 s"}, "field": {}, "opportunities": [{"title": "Properly size images", "savings_ms": 1200, "description": ""}]})
    monkeypatch.setattr(crawler, "crawl", lambda url, max_pages=25, timeout=15: {
        "start_url": url, "host": "example.in", "https": True, "robots_txt": True, "robots_blocks_all": False, "sitemap": False, "crawled": 1, "broken": [],
        "pages": [crawler.analyse_html(url, 200, "<html><head><title>Home</title></head><body><h1>Hi</h1><p>short</p></body></html>")]})
    token = jwt.encode({"sub": "48", "exp": int(time.time()) + 3600}, "test-secret-0123456789-abcdefghijklmnop", algorithm="HS256")
    c = TestClient(app)
    c.cookies.set("crm_session", token)
    return c
