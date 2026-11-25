"""Competitor analysis history and status, discovery sources, direct/indirect, and the provider usage log."""
from app.services import apify_metrics, competitor_analysis as ca, competitor_keyword_report as ck

KW = "/api/v1/businesses/{bid}/keyword-workspace/competitor-analysis"


def _project(client):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _fake(monkeypatch, da, rows, note=None):
    monkeypatch.setattr(apify_metrics, "check", lambda doms, force=False: [{"domain": doms[0], "da": da, **({"error": "Apify answered 429"} if da is None else {})}])
    monkeypatch.setattr(ck, "ranked", lambda db, b, d, limit=100, min_volume=10: {"rows": rows, "cost": 0.05, "note": note})


def test_every_run_is_kept_and_status_says_what_was_read(client, monkeypatch):
    bid = _project(client)
    base = KW.format(bid=bid)
    _fake(monkeypatch, None, [], "Real rankings could not be read (Apify answered 429).")
    r = client.post(f"{base}/analyze", json={"domain": "www.Rival.example", "limit": 10})
    assert r.status_code == 200, r.text
    assert r.json()["run"]["status"] == "retry" and set(r.json()["run"]["missing"]) == {"authority", "keywords"}
    assert r.json()["metrics"]["status"] == "retry"  # tried, nothing read: not "Pending"
    _fake(monkeypatch, None, [], None)  # DA fails, keyword actor answers empty: still nothing read, not a quota error
    client.post(f"{base}/analyze", json={"domain": "rival.example"})
    runs = client.get(f"{base}/history", params={"domain": "rival.example"}).json()["runs"]
    assert len(runs) == 2 and runs[0]["id"] > runs[1]["id"]  # the older run was not overwritten
    assert runs[1]["parts"]["authority"]["provider"] == "Moz via Apify" and runs[1]["parts"]["keywords"]["status"] == "failed"


def test_usage_log_counts_calls_and_failures(client, monkeypatch):
    bid = _project(client)
    base = KW.format(bid=bid)
    _fake(monkeypatch, None, [], "Real rankings could not be read (Apify answered 429).")
    client.post(f"{base}/analyze", json={"domain": "rival.example"})
    u = client.get(f"{base}/usage").json()
    by = {p["provider"]: p for p in u["providers"]}
    assert by["apify_moz"]["calls"] == 1 and by["apify_moz"]["failed"] == 1 and by["apify_ranked"]["failed"] == 1
    assert u["latest"][0]["target"] == "rival.example"


def test_discovery_sources_are_merged_and_kind_is_set(client):
    bid = _project(client)
    m = client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://WWW.Rival.example/about"})
    assert m.status_code == 201, m.text
    cid = m.json()["id"]
    assert m.json()["domain"] == "rival.example" and m.json()["discovery"] == ["manual"] and m.json()["kind"] is None
    again = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Rival", "website": "https://rival.example", "cid": "p1"})
    assert again.json()["id"] == cid  # one competitor per domain
    assert sorted(again.json()["discovery"]) == ["google_places", "manual"]
    k = client.patch(f"/api/v1/competitors/{cid}/kind", json={"kind": "direct"})
    assert k.status_code == 200 and k.json()["kind"] == "direct"
    assert client.patch(f"/api/v1/competitors/{cid}/kind", json={"kind": "bogus"}).status_code == 400
    assert len(client.get("/api/v1/competitors", params={"business_id": bid}).json()) == 1


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_pause():
    ca._cooldown.clear()
    yield
    ca._cooldown.clear()


def _ok(monkeypatch, calls):
    def moz(doms, force=False):
        calls.append("moz")
        return [{"domain": doms[0], "da": 40}]
    def ranked(db, b, d, limit=100, min_volume=10):
        calls.append("ranked")
        return {"rows": [{"keyword": "x"}], "cost": 0.05, "note": None}
    monkeypatch.setattr(apify_metrics, "check", moz)
    monkeypatch.setattr(ck, "ranked", ranked)


def test_settings_are_saved_clamped_and_unknown_names_ignored(client):
    base = KW.format(bid=_project(client))
    assert client.get(f"{base}/config").json()["auto_analyze"] is True
    r = client.put(f"{base}/config", json={"refresh_days": 9999, "daily_limit": 0, "keywords": False, "bogus": 1, "max_retries": "x"})
    assert r.status_code == 200
    got = r.json()
    assert got["refresh_days"] == 365 and got["daily_limit"] == 1 and got["keywords"] is False and "bogus" not in got and got["max_retries"] == 3
    assert client.get(f"{base}/config").json()["keywords"] is False  # kept


def test_a_recent_full_read_is_not_requested_again_unless_forced(client, monkeypatch):
    base = KW.format(bid=_project(client))
    calls = []
    _ok(monkeypatch, calls)
    first = client.post(f"{base}/analyze", json={"domain": "rival.example"}).json()
    assert first["cached"] is False and first["run"]["status"] == "analyzed" and calls == ["moz", "ranked"]
    again = client.post(f"{base}/analyze", json={"domain": "rival.example"}).json()
    assert again["cached"] is True and calls == ["moz", "ranked"]  # no new request
    forced = client.post(f"{base}/analyze", json={"domain": "rival.example", "force": True}).json()
    assert forced["cached"] is False and calls == ["moz", "ranked", "moz", "ranked"]
    assert len(client.get(f"{base}/history", params={"domain": "rival.example"}).json()["runs"]) == 2


def test_a_quota_answer_pauses_the_provider_instead_of_hammering_it(client, monkeypatch):
    base = KW.format(bid=_project(client))
    calls = []
    def moz(doms, force=False):
        calls.append("moz")
        return [{"domain": doms[0], "error": "Apify answered 429"}]
    monkeypatch.setattr(apify_metrics, "check", moz)
    monkeypatch.setattr(ck, "ranked", lambda db, b, d, limit=100, min_volume=10: {"rows": [{"keyword": "x"}], "cost": 0.05, "note": None})
    client.post(f"{base}/analyze", json={"domain": "a.example"})
    client.post(f"{base}/analyze", json={"domain": "b.example"})
    assert calls == ["moz"]  # the second competitor did not reach the provider
    u = client.get(f"{base}/usage").json()
    assert "apify_moz" in u["paused"]
    runs = client.get(f"{base}/history", params={"domain": "b.example"}).json()["runs"]
    assert "paused until" in runs[0]["parts"]["authority"]["error"] and runs[0]["status"] == "partial"  # keywords were still read


def test_automatic_reads_follow_the_settings_and_can_skip_a_part(client, monkeypatch):
    bid = _project(client)
    base = KW.format(bid=bid)
    calls = []
    _ok(monkeypatch, calls)
    client.put(f"{base}/config", json={"keywords": False})
    from app.db import SessionLocal
    from app.models import Business
    db = SessionLocal()
    try:
        r = ca.analyze_one(db, db.get(Business, bid), "rival.example", trigger="auto")
        assert calls == ["moz"] and r["run"]["status"] == "partial" and r["run"]["missing"] == ["keywords"]
    finally:
        db.close()


def test_due_reasons_new_retry_refresh_and_daily_limit(client, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from app.db import SessionLocal
    from app.models import Business, CompetitorAnalysisRun
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        cfg = ca.get_config(b) | {"refresh_days": 7}
        now = datetime.now(timezone.utc)
        assert ca.due_reason(db, b, "new.example", cfg) == "new"
        def run(domain, status, ago_h):
            db.add(CompetitorAnalysisRun(business_id=bid, domain=domain, status=status, trigger="auto", started_at=now - timedelta(hours=ago_h), finished_at=now - timedelta(hours=ago_h)))
            db.commit()
        run("fresh.example", "analyzed", 1)
        run("old.example", "analyzed", 24 * 8)
        run("failed-recent.example", "retry", 0.1)
        run("failed-old.example", "retry", 2)
        for _ in range(3):
            run("giveup.example", "failed", 5)
        assert ca.due_reason(db, b, "fresh.example", cfg) is None
        assert ca.due_reason(db, b, "old.example", cfg) == "refresh"
        assert ca.due_reason(db, b, "failed-recent.example", cfg) is None  # too soon to try again
        assert ca.due_reason(db, b, "failed-old.example", cfg) == "retry"
        assert ca.due_reason(db, b, "giveup.example", cfg) is None  # tried max_retries times in a row
        assert ca.due_reason(db, b, "new.example", cfg | {"auto_analyze": False}) is None
        # daily limit: nothing starts when the day's automatic reads are used up
        ca.set_config(db, b, {"daily_limit": 3})
        out = ca.start_auto(db, b, ["new.example", "failed-old.example"])
        assert out["running"] is False and out.get("limit_reached") is True
    finally:
        db.close()


def test_ratings_send_the_weights_and_labels_the_match_drawer_shows(client, monkeypatch):
    from app.competitors import relevance
    bid = _project(client)
    client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://rival.example"})
    monkeypatch.setattr(relevance, "_ai_fit", lambda *a, **k: {})  # no AI call in a test
    r = client.post(f"{KW.format(bid=bid)}/ratings", json={"location": None})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["weights"] == relevance.WEIGHTS and out["labels"]["services"] == "Product relevance" and out["direct_at"] == relevance.DIRECT_AT
    rel = next(iter(out["by_id"].values()))["relevance"]
    assert 0 <= rel["score"] <= 100 and set(rel["factors"]) <= set(relevance.WEIGHTS) and rel["label"] in ("direct", "related", "unrelated")
