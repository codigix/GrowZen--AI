"""Domain Overview: internal versus client businesses, and the DataForSEO sections (provider stubbed, no network)."""
from app.config import get_settings
from app.services import domain_intel


def _provider(calls):
    def fake(path, payload, timeout=60):
        calls.append(path)
        if "domain_rank_overview" in path:
            return {"result": [{"items": [{"metrics": {"organic": {"pos_1": 2, "pos_2_3": 3, "pos_4_10": 10, "pos_21_30": 5, "count": 98, "etv": 14.2}, "paid": {"count": 0}}}]}]}
        if "ranked_keywords" in path:
            return {"result": [{"total_count": 82, "items": [{"keyword_data": {"keyword": "customs automation", "keyword_info": {"search_volume": 70, "cpc": 4.58},
                                                                                 "search_intent_info": {"main_intent": "informational"}},
                                                              "ranked_serp_element": {"serp_item": {"rank_group": 5, "etv": 14.28}}}]}]}
        if "backlinks/summary" in path:
            return {"result": [{"rank": 90, "backlinks": 2200, "referring_domains": 1700, "referring_links_attributes": {"nofollow": 327}, "referring_links_types": {"anchor": 2200, "image": 4}}]}
        return {"result": [{"items": []}]}
    return fake


def _business(client, name, website, **extra):
    r = client.post("/api/v1/businesses", json={"name": name, "website": website, **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_internal_domain_gets_deeper_data_and_its_own_messages(client):
    own = _business(client, "Codigix", "https://www.codigix.co/")
    other = _business(client, "Some Clinic", "https://someclinic.in")
    a = client.get(f"/api/v1/businesses/{own}/seo/domain").json()
    c = client.get(f"/api/v1/businesses/{other}/seo/domain").json()
    assert a["internal"] is True and c["internal"] is False
    assert a["limits"]["keywords"] > c["limits"]["keywords"]
    assert any("agency" in x["message"].lower() or "backend/.env" in x["message"] for x in a["checks"])
    assert not any(x["id"] == "approval" for x in a["checks"])  # a client-only check


def test_placeholder_website_is_an_error(client):
    bid = _business(client, "Placeholder", "https://example.com")
    checks = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["checks"]
    assert any(x["id"] == "website" and x["level"] == "error" for x in checks)


def test_intel_needs_the_provider(client):
    bid = _business(client, "Codigix", "https://codigix.co")
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()["state"] == "not_configured"


def test_intel_sections_cache_and_failures(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "dataforseo_login", "x")
    monkeypatch.setattr(s, "dataforseo_password", "y")
    calls: list[str] = []
    monkeypatch.setattr(domain_intel, "_post", _provider(calls))
    bid = _business(client, "Codigix", "https://codigix.co", country="IN")
    j = client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()
    assert j["state"] == "ok" and j["cached"] is False
    assert j["overview"]["data"]["organic"]["top3"] == 5 and j["overview"]["data"]["organic"]["count"] == 98
    assert j["links"]["data"]["authority"] == 9 and j["links"]["data"]["follow"] == 1873
    assert j["keywords"]["data"]["rows"][0]["intent"] == "informational"
    assert j["paid_keywords"]["data"] is None  # no paid keywords: no paid calls were made
    assert calls.count("/dataforseo_labs/google/ranked_keywords/live") == 1  # organic only
    n = len(calls)
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()["cached"] is True and len(calls) == n  # no new requests
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()["cached"] is False and len(calls) > n


def test_a_failed_section_is_reported_and_not_cached(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "dataforseo_login", "x")
    monkeypatch.setattr(s, "dataforseo_password", "y")
    good = _provider([])

    def flaky(path, payload, timeout=60):
        if "backlinks/summary" in path:
            raise domain_intel.DataForSeoError("Payment required")
        return good(path, payload, timeout)
    monkeypatch.setattr(domain_intel, "_post", flaky)
    bid = _business(client, "Codigix", "https://codigix.co", country="IN")
    j = client.get(f"/api/v1/businesses/{bid}/seo/domain-intel?refresh=true").json()
    assert j["links"] == {"ok": False, "error": "Payment required"} and j["overview"]["ok"] is True
    monkeypatch.setattr(domain_intel, "_post", good)  # fixed: the next view fetches again instead of replaying the failure
    assert client.get(f"/api/v1/businesses/{bid}/seo/domain-intel").json()["links"]["ok"] is True
