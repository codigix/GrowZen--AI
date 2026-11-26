"""Slow calls (an AI provider, Google, Apify, a website, Chrome) must not hold a database connection while they wait.

Each case calls an endpoint with the outside call replaced by a stand-in that records how many pooled connections are checked out at that very moment. Signing in and the project
check read the database first, so before this change the answer was 1 (the request's own session); now it is the number before the request: 0."""
import time

import pytest

from app.db import SessionLocal, engine, release_connection
from app.models import Article, Business, Keyword
from app.services import ai, copilot, keyword_metrics, reports


def settle(seconds: float = 5.0) -> None:
    """Wait for connections that an earlier test's background thread may still hold, so a count taken during a test starts from an idle pool."""
    deadline = time.monotonic() + seconds
    while engine.pool.checkedout() and time.monotonic() < deadline:
        time.sleep(0.05)


class Seen:
    def __init__(self):
        self.counts: list[int] = []

    def record(self, value=None):
        def inner(*a, **k):
            self.counts.append(engine.pool.checkedout())
            return value() if callable(value) else value
        return inner


@pytest.fixture()
def seen():
    settle()
    return Seen()


@pytest.fixture()
def bid(client):
    b = client.post("/api/v1/businesses", json={"name": "Release Co", "website": "https://release.example", "city": "Pune", "primary_category": "Dentist"}).json()["id"]
    yield b
    db = SessionLocal()
    db.query(Keyword).filter(Keyword.business_id == b).delete()
    db.query(Article).filter(Article.business_id == b).delete()
    db.query(Business).filter(Business.id == b).delete()
    db.commit()
    db.close()


def held(seen):
    assert seen.counts, "the outside call was never reached: the test proves nothing"
    return max(seen.counts)


# ── AI ────────────────────────────────────────────────────────────────────────
def test_the_assistant_does_not_hold_a_connection_while_the_ai_answers(client, bid, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", seen.record("A helpful answer."))
    r = client.post(f"/api/v1/businesses/{bid}/assistant", json={"message": "Suggest blog topics for this month"})
    assert r.status_code == 200 and held(seen) == 0


def test_the_briefing_does_not_hold_a_connection_while_the_ai_writes(client, bid, seen, monkeypatch):
    copilot._cache.clear()
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", seen.record({"headline": "Today", "priorities": []}))
    assert client.get("/api/v1/copilot/briefing").status_code == 200 and held(seen) == 0
    copilot._cache.clear()


def test_the_alerts_do_not_hold_a_connection_while_the_ai_explains_them(client, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(copilot, "alerts", lambda db, today=None, owner_ids=None: [{"id": 0, "type": "bad_review", "business": "x", "title": "t"}])
    monkeypatch.setattr(ai, "complete_json", seen.record({"items": []}))
    r = client.get("/api/v1/copilot/alerts")
    assert r.status_code == 200 and r.json()["source"] == "ai" and held(seen) == 0


def test_the_audit_summary_and_page_rewrites_do_not_hold_a_connection(client, seen, monkeypatch):
    from app.services import audit_ai
    monkeypatch.setattr(audit_ai, "summary", seen.record({"headline": "h"}))
    monkeypatch.setattr(audit_ai, "rewrite", seen.record({"pages": []}))
    assert client.post("/api/v1/copilot/audit-summary", json={"target": "https://x.example"}).status_code == 200
    assert client.post("/api/v1/copilot/rewrite-pages", json={"kind": "title"}).status_code == 200
    assert len(seen.counts) == 2 and held(seen) == 0


def test_the_monthly_report_does_not_hold_a_connection_while_the_ai_writes(client, bid, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", seen.record("The month in words."))
    reports._words.clear()
    r = client.get(f"/api/v1/businesses/{bid}/report")
    assert r.status_code == 200 and r.json()["plain_words"] == "The month in words." and held(seen) == 0


def test_the_bulk_reports_write_their_summaries_without_a_connection_and_side_by_side(client, seen, monkeypatch):
    import threading
    # the report lists the first 50 active projects by name: "000 " keeps these two in that list however many projects earlier tests left behind
    ids = [client.post("/api/v1/businesses", json={"name": f"000 Bulk {n}", "city": "Pune"}).json()["id"] for n in ("One", "Two")]
    try:
        monkeypatch.setattr(ai, "is_configured", lambda: True)
        threads = set()
        texts = iter(range(1000))

        def complete(*a, **k):
            threads.add(threading.get_ident())
            seen.counts.append(engine.pool.checkedout())
            return f"words {next(texts)}"
        monkeypatch.setattr(ai, "complete", complete)
        reports._words.clear()
        r = client.post("/api/v1/copilot/reports")
        assert r.status_code == 200 and r.json()["ai"] is True
        mine = [x for x in r.json()["reports"] if x["business_id"] in ids]
        assert len(mine) == 2 and all(x["summary"].startswith("words ") for x in mine)
        assert [x["business"] for x in r.json()["reports"]] == sorted(x["business"] for x in r.json()["reports"])  # the same order as before (by name)
        assert held(seen) == 0
    finally:
        db = SessionLocal()
        db.query(Business).filter(Business.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_the_same_report_figures_do_not_pay_for_the_ai_twice(client, bid, seen, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", seen.record("Once."))
    reports._words.clear()
    for path in ("report", "report.csv", "report.pdf"):
        assert client.get(f"/api/v1/businesses/{bid}/{path}").status_code == 200
    assert len(seen.counts) == 1  # the page, the CSV and the PDF of the same month share one AI answer


# ── Google, Apify, websites, Chrome ───────────────────────────────────────────
def test_page_xray_and_lighthouse_do_not_hold_a_connection_while_the_page_is_read(client, bid, seen, monkeypatch):
    from app.routers import page_xray as px, page_xray_lighthouse as pl
    px._cache.clear()
    pl._cache.clear()
    monkeypatch.setattr(px.xray, "run", seen.record({"ok": True}))
    monkeypatch.setattr(pl, "resolve_and_validate", lambda url: None)
    monkeypatch.setattr(pl.lighthouse, "measure", seen.record({"scores": {}}))
    assert client.post(f"/api/v1/businesses/{bid}/page-xray", json={"url": "https://release.example/"}).status_code == 200
    assert client.post(f"/api/v1/businesses/{bid}/page-xray/lighthouse", json={"url": "https://release.example/"}).status_code == 200
    assert len(seen.counts) == 2 and held(seen) == 0


def test_keyword_difficulty_does_not_hold_a_connection_while_google_and_apify_answer(client, bid, seen, monkeypatch):
    from app.services import keyword_difficulty as kd
    monkeypatch.setattr(kd, "score", seen.record({"score": 40}))
    assert client.post(f"/api/v1/businesses/{bid}/seo/keyword-difficulty", json={"keyword": "dentist pune"}).status_code == 200
    r = client.post(f"/api/v1/businesses/{bid}/seo/keyword-difficulty/batch", json={"keywords": ["dentist pune", "implants pune"]})
    assert r.status_code == 200 and len(seen.counts) == 3 and held(seen) == 0


def test_keyword_overview_keeps_its_answer_and_holds_no_connection_during_the_ads_calls(client, bid, seen, monkeypatch):
    from app.routers import seo
    from app.services import google_ads_client as ads
    db = SessionLocal()
    db.add(Keyword(business_id=bid, keyword="dentist pune", tracked=True, rank=4, prev_rank=6, target_url="https://release.example/"))
    db.commit()
    db.close()
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    monkeypatch.setattr(ads, "geo_target_for", lambda country: "geo")
    monkeypatch.setattr(ads, "keyword_ideas", seen.record([]))
    monkeypatch.setattr(ads, "historical_metrics", seen.record({}))
    monkeypatch.setattr(seo, "_questions", lambda *a, **k: [])
    r = client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "dentist pune", "lite": True})
    assert r.status_code == 200 and held(seen) == 0
    assert r.json()["you"] == {"tracked": True, "rank": 4, "prev_rank": 6, "checked_at": None, "target_url": "https://release.example/"}  # the same answer as before


def test_growth_keywords_fill_volumes_without_a_connection_and_still_save_them(client, bid, seen, monkeypatch):
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in pune"}])
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)

    def fill(keywords, country=None):
        seen.counts.append(engine.pool.checkedout())
        for k in keywords:
            k.volume = 321
    monkeypatch.setattr(keyword_metrics, "fill", fill)
    r = client.get(f"/api/v1/businesses/{bid}/keywords")
    assert r.status_code == 200 and held(seen) == 0
    assert r.json()["keywords"][0]["volume"] == 321
    db = SessionLocal()
    assert db.query(Keyword).filter(Keyword.business_id == bid).one().volume == 321  # saved
    db.close()


def test_article_regeneration_does_not_hold_a_connection_while_the_ai_writes(client, bid, seen, monkeypatch):
    from app.services import article_regenerate as rg
    db = SessionLocal()
    a = Article(business_id=bid, keyword="k", status="completed", body="<p>x</p>")
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    monkeypatch.setattr(rg, "regenerate", seen.record({"new": "<p>y</p>"}))
    r = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/regenerate", json={"part": "full"})
    assert r.status_code == 200 and held(seen) == 0


def test_organic_rankings_hold_no_connection_while_the_page_and_moz_are_read(client, bid, seen, monkeypatch):
    from app.services import google_ads_client as ads, gsc_access, url_overview as uo
    monkeypatch.setattr(uo, "_public", lambda u: u)
    monkeypatch.setattr(uo, "authority", lambda site: {"da": 1, "rd": 1, "spam": 0, "ranking_keywords": 1})
    monkeypatch.setattr(uo, "page_analysis", seen.record({"title": "T"}))  # runs on the request's thread after the account is looked up
    monkeypatch.setattr(uo, "phrases", lambda page, keyword: [])
    monkeypatch.setattr(ads, "geo_target_for", lambda country: "geo")
    monkeypatch.setattr(ads, "keyword_ideas", lambda *a, **k: [])
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("not_connected", "No Google account is linked to this project.", None, None))
    r = client.post(f"/api/v1/businesses/{bid}/seo/organic-rankings", json={"url": "https://release.example/"})
    assert r.status_code == 200 and held(seen) == 0


# ── the helper itself ─────────────────────────────────────────────────────────
def test_release_connection_returns_the_connection_and_never_saves_pending_changes(bid):
    base = engine.pool.checkedout()
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert engine.pool.checkedout() == base + 1
        release_connection(db)
        assert engine.pool.checkedout() == base and b.name == "Release Co"  # loaded values stay readable
        b.name = "Changed, not yet saved"
        db.get(Keyword, 0)  # a read that opens a transaction again
        assert engine.pool.checkedout() == base + 1
        release_connection(db)  # a change is waiting: nothing is committed and nothing is released
        assert engine.pool.checkedout() == base + 1 and db.dirty
        db.rollback()
        other = SessionLocal()
        assert other.get(Business, bid).name == "Release Co"  # the pending change was never saved
        other.close()
    finally:
        db.close()
