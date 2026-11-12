"""Blog SERP benchmark: the real top results of a keyword, measured on the live pages (Serper and the page fetch are stubbed: no network)."""
from app.competitors import intel
from app.config import get_settings
from app.services import serp_benchmark as sb

LONG = "<html><body><nav>menu menu menu</nav><main><h1>Guide</h1>" + "<p>" + "word " * 300 + "</p><h2>Why</h2><h2>How</h2><h3>Steps</h3><h2>FAQ</h2></main><footer>foot foot</footer></body></html>"
SHORT = "<html><body><article><h2>Intro</h2><p>" + "text " * 100 + "</p></article></body></html>"
SCHEMA = '<html><body><script type="application/ld+json">{"@type":"FAQPage"}</script><p>' + "alpha " * 50 + "</p></body></html>"

ORGANIC = [
    {"position": 1, "title": "Big Guide", "link": "https://www.bigguide.com/lehenga-rental"},
    {"position": 2, "title": "Justdial listing", "link": "https://www.justdial.com/Pune/lehenga"},
    {"position": 3, "title": "Own site", "link": "https://asha.in/blog/lehenga"},
    {"position": 4, "title": "Short post", "link": "https://short.example/post"},
    {"position": 5, "title": "Schema post", "link": "https://schema.example/post"},
    {"position": 6, "title": "Broken", "link": "https://broken.example/post"},
]
PAGES = {"https://www.bigguide.com/lehenga-rental": (200, LONG), "https://short.example/post": (200, SHORT), "https://schema.example/post": (200, SCHEMA), "https://broken.example/post": (404, "")}


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "website": "https://asha.in", "city": "Pune", "country": "IN", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _stub(monkeypatch, calls):
    monkeypatch.setattr(get_settings(), "serper_api_key", "test-key")
    class FakeSerper:
        def __init__(self, *a, **k): pass
        def search(self, q, location, num=10):
            calls.append((q, location))
            return {"organic": ORGANIC}
    monkeypatch.setattr(intel, "Serper", FakeSerper)
    monkeypatch.setattr(sb, "fetch_page", lambda url: PAGES[url])
    sb._cache.clear()
    from app.routers import serp_benchmark as r
    r._hits.clear()


def test_analyse_counts_main_words_headings_and_faq():
    a = sb.analyse_html(LONG)
    assert a["word_count"] >= 300 and a["word_count"] < 320  # nav and footer words are not counted
    assert a["headings"] == 4 and a["has_faq"] is True
    assert sb.analyse_html(SHORT) == {"word_count": 101, "headings": 1, "has_faq": False}
    assert sb.analyse_html(SCHEMA)["has_faq"] is True  # FAQPage schema


def test_benchmark_skips_own_site_and_directories_and_never_invents_numbers(client, monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    bid = _project(client)
    r = client.post(f"/api/v1/businesses/{bid}/articles/serp-benchmark", json={"keyword": "Lehenga Rental  in Pune"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "serper" and d["keyword"] == "lehenga rental in pune" and d["fetched_at"]
    assert [x["domain"] for x in d["results"]] == ["bigguide.com", "short.example", "schema.example", "broken.example"]  # no justdial, no own site
    assert [x["rank"] for x in d["results"]] == [1, 4, 5, 6]
    broken = d["results"][3]
    assert broken["fetched"] is False and broken["word_count"] is None and broken["headings"] is None and broken["has_faq"] is None
    big, short, schema = d["results"][0], d["results"][1], d["results"][2]
    assert big["fetched"] and big["has_faq"] and big["headings"] == 4 and short["word_count"] == 101 and schema["has_faq"]
    counts = sorted([big["word_count"], short["word_count"], schema["word_count"]])
    assert d["median_words"] == counts[1] and d["avg_words"] == round(sum(counts) / 3)  # only the pages that were read
    assert "3" in d["note"] and calls[0][1] == "Pune, India"  # searched from the project's city


def test_nothing_readable_gives_null_not_a_guess(client, monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    monkeypatch.setattr(sb, "fetch_page", lambda url: (_ for _ in ()).throw(OSError("blocked")))
    bid = _project(client)
    d = client.post(f"/api/v1/businesses/{bid}/articles/serp-benchmark", json={"keyword": "no pages"}).json()
    assert d["median_words"] is None and d["avg_words"] is None and all(not x["fetched"] for x in d["results"])


def test_cache_means_one_serper_call_per_business_and_keyword(client, monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/articles/serp-benchmark"
    assert client.post(url, json={"keyword": "same words"}).status_code == 200
    assert client.post(url, json={"keyword": "Same   Words"}).status_code == 200
    assert len(calls) == 1
    assert client.post(url, json={"keyword": "other words"}).status_code == 200 and len(calls) == 2
    assert client.post(url, json={"keyword": "x"}).status_code == 422  # too short


def test_without_a_serper_key_it_says_so_and_does_not_fake(client, monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    monkeypatch.setattr(get_settings(), "serper_api_key", "")
    bid = _project(client)
    r = client.post(f"/api/v1/businesses/{bid}/articles/serp-benchmark", json={"keyword": "lehenga rental"})
    assert r.status_code == 503 and "SERPER_API_KEY" in r.json()["detail"] and calls == []


def test_provider_errors_and_rate_limit(client, monkeypatch):
    calls = []
    _stub(monkeypatch, calls)
    bid = _project(client)
    url = f"/api/v1/businesses/{bid}/articles/serp-benchmark"
    class Refused:
        def __init__(self, *a, **k): pass
        def search(self, *a, **k): raise intel.IntelError("The Serper API key was refused.")
    monkeypatch.setattr(intel, "Serper", Refused)
    assert client.post(url, json={"keyword": "refused words"}).status_code == 502
    from app.routers import serp_benchmark as r
    r._hits.clear()
    for _ in range(r.LIMIT):
        client.post(url, json={"keyword": "refused words"})
    assert client.post(url, json={"keyword": "refused words"}).status_code == 429


def test_benchmark_is_private_to_the_owner(client, monkeypatch):
    from test_security import login, user
    calls = []
    _stub(monkeypatch, calls)
    user("sb1@x.in", "editor")
    user("sb2@x.in", "editor")
    a, _ = login("sb1@x.in")
    o, _ = login("sb2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co", "city": "Pune"}).json()["id"]
    assert a.post(f"/api/v1/businesses/{bid}/articles/serp-benchmark", json={"keyword": "my keyword"}).status_code == 200
    assert o.post(f"/api/v1/businesses/{bid}/articles/serp-benchmark", json={"keyword": "my keyword"}).status_code == 404
