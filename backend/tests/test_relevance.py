from types import SimpleNamespace

from app.competitors import relevance as rel

RENTAL = SimpleNamespace(name="vastrbhushan Rental", primary_category="Clothes market", secondary_categories=[], services=[{"name": "lehenga"}], area="Wagholi", city="Pune",
                         description="Designer clothes for rent. Lehenga rental for weddings.")


def test_the_single_criteria():
    assert [rel.area_score(d, False) for d in (500, 2500, 4000, 8000, 15000, 40000)] == [100, 88, 72, 50, 28, 8]
    assert rel.area_score(None, True) > rel.area_score(None, False)
    assert rel.keyword_score(3, 4) == 75 and rel.keyword_score(9, 4) == 100
    assert rel.serp_score(1, 1) == 100 and rel.serp_score(10, 10) < 25 and rel.serp_score(None, None) == 0


def test_a_shop_is_not_a_competitor_of_a_rental_but_another_rental_is(monkeypatch):
    monkeypatch.setattr(rel, "_ai_fit", lambda b, c, k: {})  # no AI: the word check decides
    shop = {"name": "Dwarkadas Saree Shop", "category": "Clothing store", "address": "Wagholi, Pune", "distance_m": 2000, "appearances": 2, "best": 2, "avg_position": 3}
    other = {"name": "Glam Lehenga Rental Studio", "category": "Clothing rental service", "address": "Wagholi, Pune", "distance_m": 1500, "appearances": 3, "best": 1, "avg_position": 2,
             "site_title": "Lehenga and designer clothes on rent in Pune"}
    out = rel.rate(RENTAL, [shop, other], ["lehenga on rent in pune", "designer clothes rental in pune", "clothes on rent in pune"], {}, None, True)
    assert shop["relevance"]["label"] == "unrelated" and other["relevance"]["label"] == "direct"
    assert out["counts"] == {"direct": 1, "related": 0, "unrelated": 1} and out["ai"] is False and out["rental"] is True


def test_the_ai_judgement_is_used_and_authority_only_counts_when_known(monkeypatch):
    monkeypatch.setattr(rel, "_ai_fit", lambda b, c, k: {0: {"services": 90, "intent": 90, "kind": "clothing rental", "reason": "Rents the same outfits."}})
    c = {"name": "Rental Co", "category": "Clothing rental service", "distance_m": 1000, "appearances": 2, "best": 1, "avg_position": 1.5, "domain": "rentalco.in"}
    rel.rate(RENTAL, [c], ["a", "b"], {"rentalco.in": 40}, None, True)
    r = c["relevance"]
    assert r["judged_by"] == "ai" and r["kind"] == "clothing rental" and r["factors"]["traffic"] == 40 and r["authority_known"] and r["label"] == "direct"
    d = {"name": "Rental Co", "category": "Clothing rental service", "distance_m": 1000, "appearances": 2, "best": 1, "avg_position": 1.5}
    rel.rate(RENTAL, [d], ["a", "b"], {}, None, True)
    assert "traffic" not in d["relevance"]["factors"] and not d["relevance"]["authority_known"]


def test_near_and_visible_does_not_make_a_different_business_a_competitor(monkeypatch):
    monkeypatch.setattr(rel, "_ai_fit", lambda b, c, k: {0: {"services": 5, "intent": 80, "kind": "menswear shop", "reason": "Sells menswear."}})
    c = {"name": "Man Shop", "category": "Men's clothing store", "distance_m": 100, "appearances": 3, "best": 1, "avg_position": 1}
    rel.rate(RENTAL, [c], ["a", "b", "c"], {}, None, True)
    assert c["relevance"]["label"] == "unrelated" and c["relevance"]["score"] < rel.RELATED_AT


def test_an_ai_failure_never_stops_the_rating(monkeypatch):
    def boom(*a):
        raise RuntimeError("down")
    monkeypatch.setattr(rel, "_ai_fit", boom)
    c = {"name": "Any Rental", "category": "Rental", "appearances": 1, "best": 3}
    assert rel.rate(RENTAL, [c], ["a"], {}, None, True)["ai"] is False and "relevance" in c


def test_category_and_top_page_relevance_are_measured_only_when_there_is_something_to_compare():
    assert rel.category_score(["Clothing rental service"], "Clothing rental service") == 100
    assert rel.category_score(["Clothing rental service"], "Wedding dress rental") > rel.category_score(["Clothing rental service"], "Dental clinic")
    assert rel.category_score([], "Dental clinic") is None and rel.category_score(["x"], None) is None
    own = {"rental", "clothes", "wedding"}
    assert rel.page_score(own, {"site_title": "Wedding clothes rental in Pune"}) > rel.page_score(own, {"site_title": "Dental implants"})
    assert rel.page_score(own, {}) is None


def test_their_kept_keywords_feed_the_opportunity_and_traffic_factors(monkeypatch):
    monkeypatch.setattr(rel, "_ai_fit", lambda b, c, k: {})
    c = {"name": "Rental Co", "category": "Clothing rental service", "distance_m": 1000, "appearances": 2, "best": 1, "avg_position": 1.5, "domain": "www.rentalco.in"}
    rel.rate(RENTAL, [c], ["a", "b"], {"rentalco.in": 10}, None, True, {"opportunity": {"rentalco.in": 70}, "traffic": {"rentalco.in": 55}})
    f = c["relevance"]["factors"]
    assert f["opportunity"] == 70 and f["traffic"] == 55 and c["relevance"]["traffic_from"] == "keywords"
    assert set(f) <= set(rel.WEIGHTS) and "category" in f
