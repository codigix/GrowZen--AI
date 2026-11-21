from types import SimpleNamespace

from app.services import business_understanding as bu
from app.services import keywords

PAGES = [{"url": "https://shop.example/", "title": "Clothing rental in Pune", "description": "Designer lehengas on rent", "h1": ["Rent a lehenga"], "h2": [], "words": 120, "text": "Rent designer lehengas"}]


def _biz(client, name="Brief Co"):
    return client.post("/api/v1/businesses", json={"name": name, "website": "https://shop.example/", "city": "Pune", "services": [{"name": "Lehenga"}],
                                                   "description": "We rent designer lehengas. Rental durations are 3 and 5 days. Lehenga rental for weddings."}).json()["id"]


def test_the_brief_is_built_saved_and_feeds_the_search_words(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business
    bid = _biz(client)
    monkeypatch.setattr(bu, "read_site", lambda url, max_pages=4: PAGES)
    monkeypatch.setattr(bu, "_ai", lambda b, pages, fct: {"overview": "A lehenga rental in Pune.", "business_model": "rental", "offerings": ["Lehenga rental"], "audience": ["Brides"],
                                                          "customer_search_terms": ["Lehenga on Rent", "bridal lehenga rental", "lehenga on rent"], "competitors_are": "Rental shops.",
                                                          "competitors_are_not": "Retail shops.", "keyword_themes": [{"theme": "Lehenga", "keywords": ["lehenga on rent"]}, {"x": 1}], "next_steps": ["Add schema"]})
    r = client.post(f"/api/v1/businesses/{bid}/business-brief").json()["brief"]
    assert r["by_ai"] is True and r["business_model"] == "rental" and r["customer_search_terms"] == ["lehenga on rent", "bridal lehenga rental"]  # lower case, no repeats
    assert r["keyword_themes"] == [{"theme": "Lehenga", "keywords": ["lehenga on rent"]}] and r["pages"][0]["title"] == "Clothing rental in Pune" and "facts" in r
    assert client.get(f"/api/v1/businesses/{bid}/business-brief").json()["brief"]["overview"] == "A lehenga rental in Pune."
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert bu.search_terms(b) == ["lehenga on rent", "bridal lehenga rental"] and "bridal lehenga rental" in keywords.default_seeds(b)
    finally:
        db.close()


def test_without_an_ai_the_profile_fills_the_same_shape(client, monkeypatch):
    bid = _biz(client, "Fallback Co")
    monkeypatch.setattr(bu, "read_site", lambda url, max_pages=4: [])
    monkeypatch.setattr(bu, "_ai", lambda b, pages, fct: {})
    r = client.post(f"/api/v1/businesses/{bid}/business-brief").json()["brief"]
    assert r["by_ai"] is False and r["overview"] and r["business_model"] == "rental" and r["customer_search_terms"]
    assert set(r) >= {"offerings", "audience", "strengths", "weaknesses", "competitors_are", "keyword_themes", "next_steps", "facts", "pages", "built_at"}


def test_search_terms_are_empty_before_the_brief_exists():
    assert bu.search_terms(SimpleNamespace(business_brief=None)) == [] and bu.search_terms(SimpleNamespace()) == []


def test_the_highlighted_data_reaches_the_prompts_and_leads_the_search_words():
    b = SimpleNamespace(name="X Rental", primary_category="Clothes market", services=[], description="", secondary_categories=[],
                        business_brief={"business_model": "rental", "market": "Wagholi, Pune", "offerings": ["Lehenga rental"], "audience": ["Brides"],
                                        "customer_search_terms": ["lehenga on rent", "bridal lehenga rental"], "competitors_are": "Other rental shops.", "competitors_are_not": "Retail shops."})
    block = bu.prompt_block(b)
    assert "Kind of business: rental" in block and "Does NOT count as a competitor" in block and "Retail shops." in block and "lehenga on rent, bridal lehenga rental" in block
    assert keywords.default_seeds(b)[:2] == ["lehenga on rent", "bridal lehenga rental"]
    info = bu.basis(b)
    assert info["used"] and info["model"] == "rental" and info["terms"] == ["lehenga on rent", "bridal lehenga rental"] and info["does_not_count"] == "Retail shops."
    assert bu.prompt_block(SimpleNamespace(business_brief=None)) == "" and bu.basis(SimpleNamespace())["used"] is False


def test_keyword_planner_ideas_become_workspace_candidates(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Business
    from app.services import google_ads_client as ads, keyword_metrics, keyword_workspace as kw
    bid = _biz(client, "Planner Co")
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: True)
    asked = []

    def fake(seeds, limit=50, include_monthly=False, language="en", geo_target="x"):
        asked.append(seeds[0])
        return [{"keyword": "rental dresses near me", "avg_monthly_searches": 40500, "competition": "LOW", "competition_index": 10, "high_top_of_page_bid": 19.5},
                {"keyword": "rent your wardrobe", "avg_monthly_searches": 12, "competition": "UNSPECIFIED", "competition_index": 0, "high_top_of_page_bid": 0.0},
                {"keyword": "clothing rental", "avg_monthly_searches": 6600, "competition": "UNSPECIFIED", "competition_index": 11, "high_top_of_page_bid": 0.0}]

    monkeypatch.setattr(ads, "keyword_ideas", fake)
    db = SessionLocal()
    try:
        found, note = kw.from_planner(db, db.get(Business, bid))
    finally:
        db.close()
    assert note is None and asked and [f["keyword"] for f in found].count("rental dresses near me") == len(asked)
    big = found[0]
    assert big["kind"] == "planner" and big["volume"] == 40500 and big["difficulty"] == 10 and big["cpc"] == 19.5
    assert all(f["keyword"] != "rent your wardrobe" for f in found)  # under 30 searches a month: left out
    assert [f for f in found if f["keyword"] == "clothing rental"][0]["difficulty"] is None and "planner" in kw.COLLECTORS and kw.SOURCES["planner"] == "Google Keyword Planner"


def test_without_google_ads_the_planner_source_says_why(monkeypatch):
    from app.services import keyword_metrics, keyword_workspace as kw
    monkeypatch.setattr(keyword_metrics, "enabled", lambda: False)
    found, note = kw.from_planner(None, SimpleNamespace())
    assert found == [] and "Google Ads is not set up" in note
