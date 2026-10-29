"""AI for the website audit report: summary with top actions, and page title / meta rewrites (rules and AI)."""
from app.services import ai, audit_ai

ISSUES = [
    {"code": "missing_meta_description", "level": "warning", "area": "On-page", "title": "/about has no meta description", "fix": "Write 150-160 characters."},
    {"code": "missing_meta_description", "level": "warning", "area": "On-page", "title": "/team has no meta description", "fix": "Write 150-160 characters."},
    {"code": "noindex", "level": "critical", "area": "Indexing", "title": "/blog has noindex", "fix": "Remove noindex."},
    {"code": "slow_mobile", "level": "serious", "area": "Speed", "title": "Mobile performance 41/100", "fix": "Compress images."},
]
REPORT = {"target": "https://sai.example/", "score": 61, "scores": {"seo": 83, "performance": 41}, "pages": 5, "vitals": {"lcp": "4.1 s"}, "issues": ISSUES}
PAGES = [{"url": "https://sai.example/", "title": "Home", "h1": "Family dental care", "meta_description": "", "status": 200},
         {"url": "https://sai.example/implants", "title": "Dental Implants in Aundh, Pune | Sai Dental Care", "h1": "Dental implants", "meta_description": "Implants.", "status": 200},
         {"url": "https://sai.example/old", "title": "", "status": 404}]
BIZ = {"name": "Sai Dental Care", "category": "Dentist", "area": "Aundh", "city": "Pune", "phone": "+91 98505 22140"}


def test_summary_rules(client):
    r = client.post("/api/v1/copilot/audit-summary", json=REPORT).json()
    assert r["source"] == "rules" and r["headline"].startswith("sai.example scores 61/100") and "1 critical problem" in r["headline"]
    assert [a["code"] for a in r["actions"]] == ["noindex", "slow_mobile", "missing_meta_description"]  # worst first, grouped
    assert r["actions"][2]["title"].endswith("(+1 more like it)") and r["actions"][1]["tab"] == "speed" and "performance" in r["summary"]
    assert "sai.example" in r["client_message"]


def test_summary_ai_keeps_known_codes_only(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: {"headline": "One page is hidden from Google.", "summary": "Fix that first.",
        "client_message": "Hi, we found...", "actions": [{"code": "noindex", "title": "Let Google show /blog", "why": "It's hidden."}, {"code": "made_up", "title": "x"}]})
    r = audit_ai.summary(REPORT)
    assert r["source"] == "ai" and r["headline"] == "One page is hidden from Google." and [a["code"] for a in r["actions"]] == ["noindex"]


def test_rewrite_rules(client):
    r = client.post("/api/v1/copilot/rewrite-pages", json={"kind": "title", "business": BIZ, "pages": PAGES}).json()
    assert [x["url"] for x in r["rows"]] == ["https://sai.example/"]  # good titles and broken pages are left alone
    assert r["rows"][0] == {"url": "https://sai.example/", "before": "Home", "after": "Sai Dental Care – Dentist in Aundh"}
    m = client.post("/api/v1/copilot/rewrite-pages", json={"kind": "meta", "business": BIZ, "pages": PAGES}).json()
    assert [x["url"] for x in m["rows"]] == ["https://sai.example/"] and len(m["rows"][0]["after"]) <= 160 and "Sai Dental Care" in m["rows"][0]["after"]


def test_rewrite_ai_must_meet_limits(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    pages = PAGES + [{"url": "https://sai.example/braces", "title": "Braces", "h1": "Braces", "status": 200}]
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: {"items": [
        {"url": "https://sai.example/", "text": "Sai Dental Care: Family Dentist in Aundh, Pune"},
        {"url": "https://sai.example/braces", "text": "x" * 80}]})  # too long for a title: the rule text stays
    r = audit_ai.rewrite("title", BIZ, pages)
    rows = {x["url"]: x for x in r["rows"]}
    assert rows["https://sai.example/"]["after"] == "Sai Dental Care: Family Dentist in Aundh, Pune" and rows["https://sai.example/"]["source"] == "ai"
    assert rows["https://sai.example/braces"]["after"] == "Braces | Sai Dental Care" and r["source"] == "ai"
