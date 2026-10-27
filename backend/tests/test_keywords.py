"""Keyword discovery: real-search grouping, filters, website coverage, context and the routes."""
from types import SimpleNamespace

from app.services import keywords as kw
from app.services.providers import dataforseo

SUGGEST = {
    "dentist": ["dentist near me", "dentist costume for kids", "dentist in mumbai", "dentist pune"],
    "dentist near me": ["dentist near me open now", "best dentist near me"],
    "dentist in aundh": ["dentist in aundh pune", "best dentist in aundh"],
    "how dentist": ["how dentist clean teeth"],
    "is dentist": ["is dentist a doctor"],
    "best dentist": ["best dentist for root canal", "best dentist jobs"],
    "dentist 2026": ["dentist 2026 offers"],
    "root canal": ["root canal treatment", "root canal cost"],
}


class FakeDB:
    def scalar(self, *a, **k):
        return None

    def scalars(self, *a, **k):
        return []


def biz(**kw_):
    return SimpleNamespace(**({"id": 0, "name": "Sai Dental Care", "primary_category": "Dentist", "secondary_categories": [], "services": [{"name": "Root canal"}],
                               "area": "Aundh", "city": "Pune", "lat": None, "lng": None} | kw_))


def test_discover_groups_filters_and_scores(monkeypatch):
    monkeypatch.setattr(kw, "autocomplete", lambda q: [(t, 600 - i) for i, t in enumerate(SUGGEST.get(q.lower(), []))])
    monkeypatch.setattr(kw, "trending_today", lambda words: [])
    r = kw.discover(FakeDB(), biz(), ["dentist", "root canal"], ["Aundh", "Pune"])
    got = {x["keyword"]: x for x in r["keywords"]}
    # Junk and other cities are dropped; everything kept is about the business's topics.
    assert "dentist costume for kids" not in got and "dentist in mumbai" not in got and "best dentist jobs" not in got
    assert got["how dentist clean teeth"]["group"] == "question" and got["dentist near me open now"]["group"] == "near_me"
    assert got["dentist in aundh pune"]["group"] == "local" and got["dentist pune"]["group"] == "local"
    assert got["dentist 2026 offers"]["group"] == "fresh" and got["root canal treatment"]["group"] == "service"
    # Suggested higher and by more queries = stronger.
    assert got["dentist near me"]["strength"] >= got["best dentist near me"]["strength"] and 1 <= got["dentist near me"]["stars"] <= 5
    assert r["data_source"] == "google_autocomplete" and got["root canal cost"]["volume"] is None  # no invented numbers
    assert r["counts"]["question"] == 2 and r["website_checked"] is False


def test_coverage_against_the_audited_pages():
    pages = [{"url": "https://sai.in/root-canal", "title": "Root Canal Treatment in Aundh", "h1": "Painless root canal"},
             {"url": "https://sai.in/", "title": "Sai Dental Care", "h1": "Dentist in Aundh"}]
    places = {"aundh", "pune"}
    assert kw._coverage(kw._core("root canal treatment in aundh", places), pages) == {"status": "covered", "page": "https://sai.in/root-canal"}
    assert kw._coverage(kw._core("root canal cost", places), pages)["status"] == "covered"  # "cost" is filler
    assert kw._coverage(kw._core("dental implants", places), pages) == {"status": "gap", "page": None}


def test_default_seeds_and_queries():
    assert kw.default_seeds(biz(secondary_categories=["Cosmetic dentist"], services=[{"name": "Root canal"}, "Braces"])) == ["dentist", "cosmetic dentist", "root canal", "braces"]
    qs = [q.lower() for q, _ in kw._queries(["dentist"], ["Aundh", "Baner"], "Pune")]
    assert {"dentist near me", "dentist in aundh", "dentist in baner", "dentist pune", "how dentist"} <= set(qs) and len(qs) == len(set(qs))


def test_volumes_and_trend(monkeypatch):
    months = [{"year": 2026, "month": m, "search_volume": v} for m, v in zip(range(1, 7), [100, 100, 100, 150, 150, 150])]
    monkeypatch.setattr(dataforseo, "_post", lambda path, payload, timeout=60: {"result": [{"keyword": "Dentist Pune", "search_volume": 1300, "cpc": 0.4, "competition_index": 35, "monthly_searches": months}]})
    v = dataforseo.keyword_volumes(["dentist pune"])["dentist pune"]
    assert v["volume"] == 1300 and v["difficulty"] == 35 and v["trend"] == 50 and v["monthly"][-1] == 150


def test_keyword_routes(client, monkeypatch):
    monkeypatch.setattr(kw, "autocomplete", lambda q: [(t, 0) for t in SUGGEST.get(q.lower(), [])])
    monkeypatch.setattr(kw, "trending_today", lambda words: [])
    monkeypatch.setattr(kw, "nearby_areas", lambda b, limit=8: ["Baner", "Pashan"])
    bid = client.post("/api/v1/businesses", json={"name": "Sai Dental Care", "primary_category": "Dentist", "area": "Aundh", "city": "Pune",
                                                   "services": [{"name": "Root canal"}]}).json()["id"]
    ctx = client.get(f"/api/v1/businesses/{bid}/keywords/context").json()
    assert ctx["seeds"] == ["dentist", "root canal"] and ctx["areas"] == ["Aundh", "Pune"] and ctx["nearby"] == ["Baner", "Pashan"] and ctx["website"] is None
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist near me"}])
    r = client.post(f"/api/v1/businesses/{bid}/keywords/discover", json={"seeds": ["dentist"], "areas": ["Aundh"]}).json()
    assert next(x for x in r["keywords"] if x["keyword"] == "dentist near me")["tracked"]
    assert client.post(f"/api/v1/businesses/{bid}/keywords/discover", json={"seeds": [], "areas": []}).status_code == 422
