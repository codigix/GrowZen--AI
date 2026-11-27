"""The whole competitor workflow end to end, through the API, with the providers faked: project, discovery, selection, analysis (including a failing provider), competitor keywords,
gap, traffic, pages, trend, saving keywords without duplicates, mapping, a refresh that keeps the history, project privacy and a large keyword set."""
import time

from app.competitors import service
from app.models import CompetitorKeyword
from app.services import apify_metrics, competitor_keyword_report as ck

KW = "/api/v1/businesses/{bid}/keyword-workspace/competitor-analysis"


def _found():
    p = lambda n, site, pid: {"name": n, "rating": 4.4, "reviews": 80, "address": "MG Road, Pune", "phone": "", "website": site, "maps_link": f"https://maps.example/{pid}", "place_id": pid, "category": "Rental"}  # noqa: E731
    return [p("A Rentals", "https://www.a.example/", "p1"), p("B Rentals", "https://b.example", "p2"), p("No Site", "", "p3")]


def _fake_providers(monkeypatch, fail=()):
    from app.db import SessionLocal
    calls = {"moz": [], "ranked": []}

    def moz(doms, force=False):
        calls["moz"].append(doms[0])
        if doms[0] in fail:
            return [{"domain": doms[0], "error": "Apify answered 500"}]
        from datetime import datetime, timezone
        from app.backlinks.models import BiDomainMetric
        db = SessionLocal()
        m = db.query(BiDomainMetric).filter_by(domain=doms[0]).first() or BiDomainMetric(domain=doms[0])
        m.da, m.linking_domains, m.source, m.fetched_at = 41, 120, "apify", datetime.now(timezone.utc)
        db.add(m)
        db.commit()
        db.close()
        return [{"domain": doms[0], "scores": {"da": 41}}]

    def ranked(db, b, d, limit=100, min_volume=10):
        calls["ranked"].append(d)
        if d in fail:
            return {"rows": [], "cost": 0, "note": "Real rankings could not be read (Apify answered 500)."}
        for i, (kw, pos, vol, url) in enumerate((("saree rental pune", 3, 900, f"https://{d}/saree"), ("lehenga on rent", 8, 500, f"https://{d}/lehenga"), ("bridal wear hire", 14, 200, f"https://{d}/saree"))):
            if not db.query(CompetitorKeyword).filter_by(business_id=b.id, domain=d, keyword=kw).first():
                db.add(CompetitorKeyword(business_id=b.id, domain=d, keyword=kw, position=pos + (2 if d.startswith("b") else 0), volume=vol, traffic=vol / (pos * 4.0), url=url))
        db.commit()
        return {"rows": [1, 2, 3], "cost": 0.05, "note": None}

    monkeypatch.setattr(apify_metrics, "check", moz)
    monkeypatch.setattr(ck, "ranked", ranked)
    monkeypatch.setattr(ck, "_own_positions", lambda db, b, kws: {})
    return calls


def _project(c):
    r = c.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN", "website": "https://asha.example"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_the_whole_workflow(client, monkeypatch):
    from app.services import competitor_analysis as ca
    ca._cooldown.clear()
    bid = _project(client)
    base = KW.format(bid=bid)
    monkeypatch.setattr(service, "find_competitors", lambda *a, **k: _found())

    # 3 discover, with the typed-in and invalid cases
    r = client.post("/api/v1/competitors", json={"business_type": "clothing rental", "location": "Pune", "business_id": bid})
    assert r.status_code == 200 and {x["name"] for x in r.json()["competitors"]} == {"A Rentals", "B Rentals", "No Site"}
    assert client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "not a domain"}).status_code == 400
    assert client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://asha.example"}).status_code == 400  # your own site
    again = client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://A.example/about"})  # the same domain as a found one
    saved = client.get("/api/v1/competitors", params={"business_id": bid}).json()
    assert sorted(c["domain"] for c in saved if c["domain"]) == ["a.example", "b.example"] and again.json()["domain"] == "a.example"
    assert sorted(next(c for c in saved if c["domain"] == "a.example")["discovery"]) == ["google_places", "manual"]

    # 4 select, mark direct
    a = next(c for c in saved if c["domain"] == "a.example")
    assert client.patch(f"/api/v1/competitors/{a['id']}", json={"selected": True}).status_code == 200
    assert client.patch(f"/api/v1/competitors/{a['id']}/kind", json={"kind": "direct"}).json()["kind"] == "direct"

    # 5 analyze: one competitor works, one fails (a partial failure must not stop the other)
    calls = _fake_providers(monkeypatch, fail={"b.example"})
    ok = client.post(f"{base}/analyze", json={"domain": "a.example"}).json()
    assert ok["run"]["status"] == "analyzed" and ok["metrics"]["status"] == "analyzed" and ok["metrics"]["da"] == 41
    bad = client.post(f"{base}/analyze", json={"domain": "b.example"}).json()
    assert bad["run"]["status"] in ("failed", "retry") and bad["metrics"]["status"] in ("failed", "retry")
    assert client.post(f"{base}/analyze", json={"domain": "a.example"}).json()["cached"] is True  # not requested again
    assert calls["moz"].count("a.example") == 1

    # 6 competitor keywords / 7 gap / 8 traffic / 9 pages
    gap = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/competitor-gap").json()
    assert {r["keyword"]: r["status"] for r in gap["rows"]} == {"saree rental pune": "missing", "lehenga on rent": "missing", "bridal wear hire": "missing"}
    assert all(r["score"] is not None and 0 <= r["score"] <= 100 for r in gap["rows"])
    tk = client.post(f"{base}/top-keywords", json={"domains": ["a.example"]}).json()["keywords"]["a.example"]
    assert tk[0]["keyword"] == "saree rental pune"
    pages = client.post(f"{base}/pages", json={"domains": ["a.example", "b.example"]}).json()["pages"]
    assert {p["url"] for p in pages} == {"https://a.example/saree", "https://a.example/lehenga"} and pages[0]["keywords"] == 2

    # 12 save keywords: from two places, no duplicate
    kurl = f"/api/v1/businesses/{bid}/keywords"
    first = client.post(kurl, json=[{"keyword": "saree rental pune", "volume": 900, "source": {"kind": "competitors", "label": "Competitor keywords: a.example", "competitor": "a.example"}}]).json()
    second = client.post(kurl, json=[{"keyword": "Saree Rental  Pune", "source": {"kind": "google_ideas", "label": "Keyword gap", "competitor": "b.example"}}]).json()
    assert first["added"] == 1 and second["added"] == 0 and second["existing"] == ["saree rental pune"]
    saved_kw = client.get(kurl).json()["keywords"]
    assert len(saved_kw) == 1 and set(saved_kw[0]["source"]["groups"]) == {"competitor_keywords", "competitor_gap"}

    # 13 map it
    out = client.post(f"/api/v1/businesses/{bid}/keyword-mapping/assign", json={"ids": [saved_kw[0]["id"]], "target_url": "https://asha.example/saree", "role": "primary", "status": "optimization"}).json()
    assert out["updated"] == 1 and out["statuses"][0]["status"] == "optimization"

    # 14 refresh: the old run stays
    forced = client.post(f"{base}/analyze", json={"domain": "a.example", "force": True}).json()
    assert forced["cached"] is False
    hist = client.get(f"{base}/history", params={"domain": "a.example"}).json()["runs"]
    assert len(hist) == 2 and all(h["status"] == "analyzed" for h in hist)
    tr = client.post(f"{base}/trend", json={"domains": ["a.example"]}).json()["trend"]["a.example"]
    assert len(tr) == 2  # two real runs, two points
    u = client.get(f"{base}/usage").json()
    by = {p["provider"]: p for p in u["providers"]}
    assert by["apify_moz"]["calls"] == 3 and by["apify_moz"]["failed"] == 1 and u["today"]["all"] == 3


def test_missing_keys_and_a_provider_that_is_down_are_reported_not_hidden(client, monkeypatch):
    from app.services import competitor_analysis as ca
    ca._cooldown.clear()
    bid = _project(client)
    base = KW.format(bid=bid)
    monkeypatch.setattr(apify_metrics, "check", lambda doms, force=False: [{"domain": doms[0], "error": "no Apify key set"}])
    monkeypatch.setattr(ck, "ranked", lambda db, b, d, limit=100, min_volume=10: {"rows": [], "cost": 0, "note": "Real rankings could not be read (no Apify key)."})
    r = client.post(f"{base}/analyze", json={"domain": "rival.example"}).json()
    assert r["run"]["status"] == "retry" and r["metrics"]["da"] is None and r["metrics"]["keywords"] is None  # no figure invented
    assert any("Domain Authority" in n for n in r["notes"]) and any("Keywords" in n for n in r["notes"])
    # empty results everywhere else answer with empty lists, not errors
    assert client.get(f"/api/v1/businesses/{bid}/keyword-workspace/competitor-gap").json()["rows"] == []
    assert client.post(f"{base}/pages", json={"domains": ["rival.example"]}).json()["pages"] == []
    assert client.post(f"{base}/trend", json={"domains": ["rival.example"]}).json()["trend"] == {}


def test_a_large_keyword_set_stays_fast_and_is_capped(client, monkeypatch):
    bid = _project(client)
    monkeypatch.setattr(service, "find_competitors", lambda *a, **k: _found())
    client.post("/api/v1/competitors", json={"business_type": "clothing rental", "location": "Pune", "business_id": bid})
    monkeypatch.setattr(ck, "_own_positions", lambda db, b, kws: {})
    from app.db import SessionLocal
    from app.competitors import hygiene
    monkeypatch.setattr(hygiene, "saved_competitor_domains", lambda db, b, limit=12: ["a.example"])
    db = SessionLocal()
    db.bulk_save_objects([CompetitorKeyword(business_id=bid, domain="a.example", keyword=f"saree keyword {i}", position=1 + i % 50, volume=100 + i, traffic=5.0, url=f"https://a.example/p{i % 40}") for i in range(3000)])
    db.commit()
    db.close()
    t = time.time()
    gap = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/competitor-gap").json()
    pages = client.post(f"{KW.format(bid=bid)}/pages", json={"domains": ["a.example"]}).json()["pages"]
    assert time.time() - t < 15
    assert len(gap["rows"]) == 2000 and gap["total"] == 3000  # the table is capped, the total is honest
    assert len(pages) == 40 and all(len(p["list"]) <= 15 for p in pages)


def test_another_users_project_is_invisible_to_every_competitor_endpoint(client):
    from test_security import login, user
    user("owner-e2e@x.in", "editor")
    user("other-e2e@x.in", "editor")
    a, _ = login("owner-e2e@x.in")
    b, _ = login("other-e2e@x.in")
    made = a.post("/api/v1/businesses", json={"name": "Private Rentals", "city": "Pune"})
    assert made.status_code == 201, made.text
    bid = made.json()["id"]
    cid = a.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://rival.example"}).json()["id"]
    base = KW.format(bid=bid)
    for method, url, body in (("get", f"{base}/history?domain=rival.example", None), ("get", f"{base}/usage", None), ("get", f"{base}/config", None), ("put", f"{base}/config", {"daily_limit": 1}),
                              ("post", f"{base}/analyze", {"domain": "rival.example"}), ("post", f"{base}/trend", {"domains": ["rival.example"]}), ("post", f"{base}/top-keywords", {"domains": ["rival.example"]}),
                              ("post", f"{base}/pages", {"domains": ["rival.example"]}), ("post", f"/api/v1/businesses/{bid}/keyword-mapping/assign", {"ids": [1], "role": "primary"}),
                              ("get", f"/api/v1/businesses/{bid}/keyword-workspace/competitor-gap", None)):
        r = getattr(b, method)(url, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, (method, url, r.status_code)
    assert b.patch(f"/api/v1/competitors/{cid}/kind", json={"kind": "direct"}).status_code == 404
    assert b.delete(f"/api/v1/competitors/{cid}").status_code == 404
    assert b.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "https://x.example"}).status_code == 404
