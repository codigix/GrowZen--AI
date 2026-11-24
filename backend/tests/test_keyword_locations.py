from app.services import google_ads_client as ads


def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Loc Co", "website": "https://loc.example/", "city": "Pune", "country": "IN", "target_areas": ["Wakad, Pune"]}).json()["id"]


def test_one_keyword_is_shown_place_by_place_with_its_twelve_months(client, monkeypatch):
    from app.services import keyword_locations as kl
    kl._geo.clear()
    kl._metrics.clear()
    codes = {"Pune": "geoTargetConstants/1007740", "Wakad, Pune": "geoTargetConstants/9999"}
    monkeypatch.setattr(ads, "geo_constants", lambda names, code="IN": {n: {"resource": codes[n], "canonical": f"{n},Maharashtra,India", "type": "City"} for n in names if n in codes})
    data = {"geoTargetConstants/2356": {"volume": 6600, "competition": "LOW", "competition_index": 16, "cpc": 80.0}, "geoTargetConstants/1007740": {"volume": 2400, "competition": "MEDIUM", "competition_index": 41, "cpc": 90.5}}
    seen = []

    def metrics(keywords, geo_target="", language=""):
        seen.append(geo_target)
        m = data.get(geo_target)
        return {keywords[0]: {**m, "monthly": [{"year": 2026, "month": "OCTOBER", "searches": 2300}, {"year": 2026, "month": "NOVEMBER", "searches": 2400}]}} if m else {}
    monkeypatch.setattr(ads, "historical_metrics", metrics)
    bid = _biz(client)
    r = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/locations", params={"keyword": "Digital Marketing Agency", "extra": "Atlantis"}).json()
    assert r["keyword"] == "digital marketing agency" and r["difficulty"] == 16 and r["reason"] is None  # the difficulty is the country's competition index
    by = {x["name"]: x for x in r["locations"]}
    assert by["India"]["volume"] == 6600 and by["Pune"]["volume"] == 2400 and by["Pune"]["index"] == 41 and len(by["Pune"]["monthly"]) == 2
    assert by["Wakad, Pune"]["volume"] is None and by["Wakad, Pune"]["found_as"]  # Google knows the place but has no figures: shown without numbers, never estimated
    assert by["Atlantis"]["found_as"] is None and "no location" in by["Atlantis"]["note"]
    n = len(seen)
    client.get(f"/api/v1/businesses/{bid}/keyword-workspace/locations", params={"keyword": "Digital Marketing Agency", "extra": "Atlantis"})
    assert len(seen) == n  # kept for a day: Google is not asked again


def test_without_google_ads_the_reason_is_given(client, monkeypatch):
    from app.services import keyword_locations as kl
    kl._geo.clear()
    kl._metrics.clear()
    def refuse(*a, **k):
        raise ads.GoogleAdsNotConfigured("Google Ads is not configured.")
    monkeypatch.setattr(ads, "geo_constants", refuse)
    monkeypatch.setattr(ads, "historical_metrics", refuse)
    bid = _biz(client)
    r = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/locations", params={"keyword": "seo services"}).json()
    assert "not configured" in r["reason"] and r["difficulty"] is None


def test_where_a_keyword_is_used_is_read_from_the_pages_blogs_faqs_posts_and_profile(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Article, Post
    from app.services import keyword_placement as kp
    bid = client.post("/api/v1/businesses", json={"name": "Use Co", "website": "https://use.example/", "city": "Pune", "description": "We are a healthcare digital marketing agency in Pune."}).json()["id"]
    client.patch(f"/api/v1/businesses/{bid}", json={"faqs": [{"q": "What does a healthcare digital marketing agency do?", "a": "It helps clinics get patients."}, {"q": "How long does SEO take?", "a": "Months."}]})
    monkeypatch.setattr(kp, "_pages", lambda db, b: [{"url": "https://use.example/healthcare-digital-marketing-agency/", "title": "Healthcare Digital Marketing Agency", "h1": "x", "meta_description": "", "_generic": False},
                                                     {"url": "https://use.example/contact/", "title": "Contact", "h1": "Contact", "meta_description": "", "_generic": False}])
    db = SessionLocal()
    try:
        db.add(Article(business_id=bid, keyword="healthcare digital marketing agency", title="How to choose a healthcare digital marketing agency", status="completed", body="<p>text</p>", wp_status="publish", wp_url="https://use.example/choose/"))
        db.add(Article(business_id=bid, keyword="seo", title="SEO basics", status="completed", body="<p>seo</p>"))
        db.add(Post(business_id=bid, post_type="Update", body="Our healthcare digital marketing agency helps clinics.", status="published"))
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/usage", params={"keyword": "Healthcare Digital Marketing Agency"}).json()
    assert [p["path"] for p in r["pages"]] == ["/healthcare-digital-marketing-agency"] and "title" in r["pages"][0]["places"] and "address" in r["pages"][0]["places"]
    assert [x["title"] for x in r["blogs"]] == ["How to choose a healthcare digital marketing agency"] and r["blogs"][0]["state"] == "Live" and r["blogs"][0]["in_title"] is True
    assert [x["q"] for x in r["faqs"]] == ["What does a healthcare digital marketing agency do?"] and r["posts"][0]["state"] == "Live" and r["profile"]["description"] is True
    assert r["counts"] == {"pages": 1, "blogs": 1, "faqs": 1, "posts": 1, "profile": 1}
    none = client.get(f"/api/v1/businesses/{bid}/keyword-workspace/usage", params={"keyword": "gown rental"}).json()
    assert none["counts"] == {"pages": 0, "blogs": 0, "faqs": 0, "posts": 0, "profile": 0}
