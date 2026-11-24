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
