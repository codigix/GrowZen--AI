"""SERP X-Ray: the live Google results for one search with each top page measured (Serper, page fetches and RDAP are stubbed: no network)."""
import pytest

from app.competitors import intel
from app.routers import serp_xray as router
from app.services import page_xray, serp_xray

PAGE_FAQ = "<html><head><script type='application/ld+json'>{\"@type\":\"FAQPage\"}</script><meta name='generator' content='WordPress 6.5'></head><body><main><h1>Rentals</h1><h2>What does it cost?</h2><p>" + "word " * 400 + "</p><h2>FAQ</h2><h3>Q</h3></main></body></html>"
PAGE_PLAIN = "<html><body><main><h1>Shop</h1><p>" + "word " * 100 + "</p></main></body></html>"

RES = {
    "organic": [
        {"position": 1, "title": "Big Rentals", "link": "https://bigrentals.in/lehenga", "snippet": "Rent lehenga in Pune", "sitelinks": [{"title": "Prices", "link": "https://bigrentals.in/prices"}]},
        {"position": 2, "title": "Asha Rentals", "link": "https://www.asha.in/pune", "snippet": "Our shop"},
        {"position": 3, "title": "Plain Shop", "link": "https://plainshop.in/", "snippet": "A shop"},
        {"position": 4, "title": "Tracked", "link": "https://www.google.com/goto?url=x", "displayedLink": "https://tracked.in › blog", "snippet": "t"},
        {"position": 15, "title": "Down the list", "link": "https://far.in/x", "snippet": "f"},
    ],
    "answerBox": {"title": "Cost", "link": "https://bigrentals.in/prices", "snippet": "From 999"},
    "peopleAlsoAsk": [{"question": "How much to rent a lehenga?", "snippet": "999", "link": "https://q.in"}, {"question": "", "snippet": "x"}],
    "relatedSearches": [{"query": "lehenga rental near me"}, {"query": "bridal lehenga hire"}],
    "knowledgeGraph": {"title": "x"},
    "places": [{"title": "Big Rentals", "rating": 4.8, "ratingCount": 300}, {"title": "Asha Rentals", "rating": 4.2, "ratingCount": 12}],
    "videos": [{}, {}], "images": [{}], "topStories": [{}], "shopping": [],
}


@pytest.fixture(autouse=True)
def stubs(monkeypatch):
    serp_xray._cache.clear()
    serp_xray._rdap_cache.clear()
    router._hits.clear()
    monkeypatch.setattr(intel, "serper_enabled", lambda: True)
    monkeypatch.setattr(serp_xray, "_serper_search", lambda b, kw, loc, lang, country: RES)
    calls = {"fetch": [], "rdap": []}

    def fetch(url):
        calls["fetch"].append(url)
        if "plainshop" in url:
            return page_xray.Fetched(url=url, final_url=url, status=200, headers={"server": "nginx"}, html=PAGE_PLAIN, size_bytes=10)
        if "far.in" in url:
            raise page_xray.XrayError(502, "could not fetch")
        return page_xray.Fetched(url=url, final_url=url, status=200, headers={"server": "nginx"}, html=PAGE_FAQ, size_bytes=10)

    def rdap(domain):
        calls["rdap"].append(domain)
        return {"domain": domain, "age_days": 3650, "registrar": "GoDaddy", "error": None} if "bigrentals" in domain else {"domain": domain, "age_days": None, "registrar": None, "error": "RDAP did not answer"}
    monkeypatch.setattr(page_xray, "fetch_page", fetch)
    monkeypatch.setattr(page_xray, "rdap_lookup", rdap)
    return calls


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "city": "Pune", "country": "IN", "website": "https://asha.in", "primary_category": "Clothing rental", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_features_are_parsed_from_the_serper_answer():
    f = serp_xray.parse_features(RES)
    assert f["featured_snippet"] == {"type": "snippet", "title": "Cost", "url": "https://bigrentals.in/prices", "text": "From 999"}
    assert [q["question"] for q in f["people_also_ask"]] == ["How much to rent a lehenga?"]  # a question-less entry is dropped
    assert f["related_searches"] == ["lehenga rental near me", "bridal lehenga hire"]
    assert f["knowledge_graph"] is True and f["videos"] == 2 and f["images"] is True and f["top_stories"] == 1 and f["shopping"] is False
    assert f["local_pack"][0] == {"name": "Big Rentals", "rating": 4.8, "reviews": 300}
    assert serp_xray.parse_features({"answerBox": {"answer": "42"}})["featured_snippet"]["type"] == "answer"
    empty = serp_xray.parse_features({})
    assert empty["featured_snippet"] is None and empty["people_also_ask"] == [] and empty["local_pack"] == []


def test_xray_measures_the_top_results_and_finds_your_position(client, stubs):
    bid = _project(client)
    r = client.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "Lehenga rental in Pune"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "serper" and d["keyword"] == "Lehenga rental in Pune" and d["fetched_at"] and d["location"]
    assert d["your"]["found"] and d["your"]["position"] == 2 and d["your"]["page"] == 1 and d["your"]["domain"] == "asha.in" and d["your"]["url"] == "https://www.asha.in/pune"
    rows = {x["domain"]: x for x in d["results"]}
    big = rows["bigrentals.in"]
    assert big["position"] == 1 and big["fetched"] and big["word_count"] >= 400 and big["has_faq"] is True and "FAQPage" in big["schema_types"]
    assert big["domain_age_days"] == 3650 and big["registrar"] == "GoDaddy" and big["sitelinks"][0]["title"] == "Prices" and big["is_you"] is False
    assert big["cms"] == "WordPress"
    assert rows["asha.in"]["is_you"] is True and rows["asha.in"]["position"] == 2
    plain = rows["plainshop.in"]
    assert plain["fetched"] and plain["has_faq"] is False and 80 <= plain["word_count"] <= 120
    # the Google tracking link is not opened (its path is only approximate)
    tracked = rows["tracked.in"]
    assert tracked["fetched"] is False and tracked["word_count"] is None and tracked["schema_types"] == [] and tracked["cms"] is None
    assert not any("goto" in u or "tracked.in" in u for u in stubs["fetch"])
    assert any("tracking links" in n for n in d["notes"])
    # the result beyond the top 10 positions never appears, but a far one still counts for your position when it is yours
    assert all(x["position"] <= 15 for x in d["results"])


def test_enrichment_failures_are_nulls_not_guesses(client, stubs):
    bid = _project(client)
    d = client.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "lehenga rental pune"}).json()
    far = next(x for x in d["results"] if x["domain"] == "far.in")
    assert far["fetched"] is False and far["word_count"] is None and far["headings"] is None and far["has_faq"] is None and far["domain_age_days"] is None
    assert any("could not be opened" in n for n in d["notes"])


def test_your_position_not_found_and_no_website(client, monkeypatch):
    bid = _project(client, website="https://nowhere-else.in")
    d = client.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "lehenga rental pune"}).json()
    assert {k: d["your"][k] for k in ("found", "position", "page", "url", "domain")} == {"found": False, "position": None, "page": None, "url": None, "domain": "nowhere-else.in"}
    assert d["insights"][0]["level"] == "critical" and "not in the top 100" in d["insights"][0]["title"]
    nb = client.post("/api/v1/businesses", json={"name": "No Site Co", "city": "Pune"}).json()["id"]
    d2 = client.post(f"/api/v1/businesses/{nb}/serp-xray", json={"keyword": "lehenga rental pune"}).json()
    assert d2["your"]["found"] is False and d2["your"]["domain"] is None and any("no website" in n for n in d2["notes"])


def test_insights_math(client):
    bid = _project(client)
    d = client.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "lehenga rental pune"}).json()
    titles = " | ".join(i["title"] for i in d["insights"])
    assert "You are #2 for" in titles and next(i for i in d["insights"] if i["title"].startswith("You are #2"))["level"] == "good"
    assert "of 3 top pages have an FAQ section" in titles or "of 2 top pages have an FAQ section" in titles
    assert "years old on average" in titles and "local map pack" in titles and "People also ask shows 1 question for this search" in titles and "featured snippet" in titles
    pack = next(i for i in d["insights"] if "local map pack" in i["title"])
    assert "You are #2 in it" in pack["title"]  # Asha Rentals is the 2nd listing in the pack
    levels = serp_xray.build_insights("k", {"found": True, "position": 14, "domain": "a.in"}, [], serp_xray.parse_features({}), None)
    assert levels[0]["level"] == "warning" and "page 2" in levels[0]["title"]
    top = serp_xray.build_insights("k", {"found": True, "position": 1, "domain": "a.in"}, [], serp_xray.parse_features({}), None)
    assert top[0]["level"] == "good"
    short = serp_xray.build_insights("k", {"found": True, "position": 5, "domain": "a.in"}, [
        {"fetched": True, "comparable": True, "word_count": 300, "has_faq": False, "is_you": True, "domain_age_days": None},
        {"fetched": True, "comparable": True, "word_count": 1000, "has_faq": True, "is_you": False, "domain_age_days": None},
        {"fetched": True, "comparable": True, "word_count": 1200, "has_faq": True, "is_you": False, "domain_age_days": None}], serp_xray.parse_features({}), None)
    assert any("Your page has 300 words; the typical top result has 1000" in i["title"] for i in short)


def test_needs_the_key_cache_and_rate_limit(client, monkeypatch, stubs):
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/serp-xray"
    searched = []
    monkeypatch.setattr(serp_xray, "_serper_search", lambda *a: searched.append(a) or RES)
    assert client.post(url, json={"keyword": "x"}).status_code == 422  # too short
    assert client.post(url, json={"keyword": "lehenga rental pune"}).status_code == 200
    assert client.post(url, json={"keyword": "Lehenga  rental pune"}).status_code == 200  # same search: the cache answers
    assert len(searched) == 1
    monkeypatch.setattr(intel, "serper_enabled", lambda: False)
    r = client.post(url, json={"keyword": "another search"})
    assert r.status_code == 503 and "SERPER_API_KEY" in r.json()["detail"]
    monkeypatch.setattr(intel, "serper_enabled", lambda: True)
    monkeypatch.setattr(serp_xray, "_serper_search", lambda *a: (_ for _ in ()).throw(intel.IntelError("Serper credits are used up")))
    assert client.post(url, json={"keyword": "yet another"}).status_code == 502
    router._hits.clear()
    monkeypatch.setattr(serp_xray, "_serper_search", lambda *a: RES)
    codes = [client.post(url, json={"keyword": f"search {i} lehenga"}).status_code for i in range(router.LIMIT + 1)]
    assert codes[: router.LIMIT] == [200] * router.LIMIT and codes[-1] == 429


def test_rdap_is_cached_and_a_failed_lookup_is_retried(stubs):
    a = serp_xray.rdap_cached("www.bigrentals.in")
    b = serp_xray.rdap_cached("blog.bigrentals.in")  # the same registered domain: one lookup
    assert a == b == {"age_days": 3650, "registrar": "GoDaddy"} and stubs["rdap"].count("bigrentals.in") == 1
    assert serp_xray.rdap_cached("nodata.in") == {"age_days": None, "registrar": None}
    serp_xray.rdap_cached("nodata.in")
    assert stubs["rdap"].count("nodata.in") == 2  # nothing was learned, so nothing was cached


def test_projects_are_private(client):
    from test_security import login, user
    user("sx1@x.in", "editor")
    user("sx2@x.in", "editor")
    a, _ = login("sx1@x.in")
    o, _ = login("sx2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co", "city": "Pune"}).json()["id"]
    assert a.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "my own search"}).status_code == 200
    assert o.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "my own search"}).status_code == 404


def test_social_and_script_built_pages_do_not_distort_the_comparison(client, monkeypatch, stubs):
    res = {"organic": [
        {"position": 1, "title": "Insta", "link": "https://www.instagram.com/shop/", "snippet": "i"},
        {"position": 2, "title": "Empty", "link": "https://spa.in/", "snippet": "s"},
        {"position": 3, "title": "Real A", "link": "https://reala.in/", "snippet": "a"},
        {"position": 4, "title": "Real B", "link": "https://realb.in/", "snippet": "b"}]}
    monkeypatch.setattr(serp_xray, "_serper_search", lambda *a: res)
    short = "<html><body><main><p>loading</p></main></body></html>"

    def fetch(url):
        html = short if ("instagram" in url or "spa.in" in url) else PAGE_FAQ
        return page_xray.Fetched(url=url, final_url=url, status=200, headers={}, html=html, size_bytes=1)
    monkeypatch.setattr(page_xray, "fetch_page", fetch)
    bid = _project(client)
    d = client.post(f"/api/v1/businesses/{bid}/serp-xray", json={"keyword": "something else entirely"}).json()
    rows = {x["domain"]: x for x in d["results"]}
    assert rows["instagram.com"]["comparable"] is False and "social or listing" in rows["instagram.com"]["note"]
    assert rows["spa.in"]["comparable"] is False and "JavaScript" in rows["spa.in"]["note"]
    assert rows["reala.in"]["comparable"] is True and rows["reala.in"]["note"] is None
    length = next(i for i in d["insights"] if "words long" in i["title"])
    assert "2 article pages" in length["title"] and "2 social, listing or script-built pages left out" in length["title"]
    assert "median" in length["title"] and "about 7 words" not in length["title"]
