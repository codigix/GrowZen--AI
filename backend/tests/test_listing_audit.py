from types import SimpleNamespace

from app.competitors import listing_audit as la

FULL = {"basics": {"name": "Glam Rental", "category": "Clothing rental service", "summary": "Rents lehengas.", "phone": "+91 98765 43210", "website": None, "status": "open", "address": "Wagholi, Pune"},
        "hours": ["Monday: 10-8"], "reputation": {"rating": 4.7, "count": 120, "photos": 10, "reviews": [{"when": "2 weeks ago"}, {"when": "3 months ago"}]}, "features": ["a", "b", "c"], "maps_url": "https://maps.example/x"}
THIN = {"basics": {"name": "Walk In", "category": "", "summary": None, "phone": None, "website": None}, "hours": [], "reputation": {"rating": None, "count": 3, "photos": 1, "reviews": []}, "features": []}


def test_review_age_is_read_from_googles_words_and_dates():
    assert la.age_days("a month ago") == 30 and la.age_days("3 weeks ago") == 21 and la.age_days("2 years ago") == 730 and la.age_days("an hour ago") == 0
    assert la.age_days("2020-01-01T00:00:00Z") > 365 and la.age_days(None) is None and la.age_days("whenever") is None


def test_a_listing_is_scored_on_what_a_customer_sees():
    full, thin = la.score_listing(FULL), la.score_listing(THIN)
    by = {r["key"]: r["status"] for r in full["rows"]}
    assert by["website"] == "bad" and by["photos"] == "ok" and by["recent"] == "ok" and by["rating"] == "ok" and by["attributes"] == "ok"
    assert full["facts"]["newest_review_days"] == 14 and full["facts"]["reviews"] == 120
    assert 70 <= full["score"] <= 90 and thin["score"] < 10  # the missing website costs 12 points, a bare listing earns almost nothing
    assert len(full["rows"]) == len(la.CHECKS)


def test_overlap_finds_the_same_service_in_different_words():
    o = la.overlap(["Lehenga rental", "Designer couture"], ["lehenga on rent", "Bridal gown rental", "saree draping"])
    assert o["shared"] == ["lehenga on rent"] and o["only_them"] == ["Bridal gown rental", "saree draping"] and o["only_us"] == ["Designer couture"]
    assert la.same_thing("Clothing rental", "rental clothing") and not la.same_thing("saree shop", "dental clinic")


def test_a_listing_without_an_ai_still_says_what_it_offers(monkeypatch):
    monkeypatch.setattr("app.services.ai.is_configured", lambda: False)
    u = la.understand(FULL)
    assert u["by_ai"] is False and u["services"][0] == "Clothing rental service" and u["summary"] == "Rents lehengas."


def test_the_ai_reads_services_and_keywords_from_the_listing(monkeypatch):
    monkeypatch.setattr("app.services.ai.is_configured", lambda: True)
    seen = {}
    def fake(system, user, **kw):
        seen["user"] = user
        return {"kind": "clothing rental", "services": ["Lehenga rental", "Gown rental", " "], "keywords": ["Lehenga On Rent", "lehenga on rent"], "summary": "Rents outfits for weddings."}
    monkeypatch.setattr("app.services.ai.complete_json", fake)
    u = la.understand(FULL)
    assert u == {"kind": "clothing rental", "services": ["Lehenga rental", "Gown rental"], "keywords": ["lehenga on rent"], "summary": "Rents outfits for weddings.", "by_ai": True}
    assert "Clothing rental service" in seen["user"] and "Rents lehengas." in seen["user"]


def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Listing Co", "website": "https://listing.example/", "services": [{"name": "Lehenga rental"}]}).json()["id"]


def test_audit_then_compare_for_a_competitor_with_no_website(client, monkeypatch):
    monkeypatch.setattr("app.services.maps_public.read", lambda pid, fresh=False: FULL if pid == "placeA" else THIN)
    monkeypatch.setattr("app.services.ai.is_configured", lambda: True)
    monkeypatch.setattr("app.services.ai.complete_json", lambda *a, **k: {"kind": "clothing rental", "services": ["Lehenga rental", "Gown rental"], "keywords": ["lehenga on rent"], "summary": "s"})
    bid = _biz(client)
    c = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Glam Rental", "cid": "placeA", "address": "Wagholi, Pune", "rating": 4.7, "reviews": 120}).json()
    assert c["website"] is None and c["place_id"] == "placeA" and "listing" not in c
    again = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Glam Rental", "cid": "placeA"}).json()
    assert again["id"] == c["id"]  # saved once
    assert client.post(f"/api/v1/competitors/{c['id']}/listing-compare").status_code == 409  # audit first
    out = client.post(f"/api/v1/competitors/{c['id']}/listing-audit").json()
    assert out["score"] >= 70 and out["understanding"]["services"] == ["Lehenga rental", "Gown rental"]
    listed = [x for x in client.get("/api/v1/competitors", params={"business_id": bid}).json() if x["id"] == c["id"]][0]
    assert listed["listing_done"] is True and listed["listing_score"] == out["score"] and "listing" not in listed
    cmp = client.post(f"/api/v1/competitors/{c['id']}/listing-compare").json()
    assert cmp["kind"] == "listing" and cmp["services"]["shared"] == ["Lehenga rental"] and cmp["services"]["only_them"] == ["Gown rental"] and len(cmp["checks"]) == len(la.CHECKS)
    assert cmp["you"]["listing_read"] is False and cmp["scores"]["theirs"] == out["score"]


def test_gap_keywords_from_the_comparison_can_be_added_to_my_keywords(client):
    bid = _biz(client)
    body = [{"keyword": "party dress rental", "source": {"kind": "competitor_compare", "label": "Style Story Google listing", "side": "competitor", "from": "Style Story", "pages": [], "searches": None, "at": "2026-11-21"}},
            {"keyword": "blazer on rent", "source": {"kind": "competitor_compare", "label": "Style Story Google listing", "side": "competitor", "from": "Style Story", "pages": [], "searches": None, "at": "2026-11-21"}}]
    r = client.post(f"/api/v1/businesses/{bid}/keywords", json=body)
    assert r.status_code in (200, 201), r.text
    got = client.get(f"/api/v1/businesses/{bid}/keywords").json()
    mine = [k["keyword"] for k in (got.get("keywords") if isinstance(got, dict) else got)]
    assert "party dress rental" in mine and "blazer on rent" in mine


def test_choosing_a_maps_business_with_no_website_saves_it_as_chosen(client):
    bid = _biz(client)
    assert client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": None, "name": "Walk In"}).status_code == 422  # the by-website route needs a website
    made = client.post("/api/v1/competitors/maps", json={"business_id": bid, "name": "Walk In Studio", "cid": "placeZ", "address": "Wagholi", "rating": 4.6, "reviews": 12})
    assert made.status_code == 201 and made.json()["selected"] is True and made.json()["website"] is None
    cid = made.json()["id"]
    assert client.patch(f"/api/v1/competitors/{cid}", json={"selected": False}).json()["selected"] is False  # and it can be left out again
