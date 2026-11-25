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
