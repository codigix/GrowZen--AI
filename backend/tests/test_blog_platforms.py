"""The top blogging platforms list: always there, ranked for the business, checked to be online, and savable to the link-building plan."""
from urllib.parse import urlsplit

import pytest

from app.db import SessionLocal
from app.models import Article, Business
from app.services import blog_platforms as bp


@pytest.fixture()
def shop(client):
    """A clothing-rental shop in Pune (India) with one article."""
    bid = client.post("/api/v1/businesses", json={"name": "Rental Shop", "website": "https://rentalshop.example/", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    b = db.get(Business, bid)
    b.country, b.primary_category, b.services = "IN", "Clothes market", [{"name": "Rental cloths"}]
    a = Article(business_id=bid, keyword="fashion cloth", status="completed", title="Fashion Cloth Guide", body="<p>x</p>")
    db.add(a)
    db.commit()
    yield bid, a.id, db
    db.close()


def test_the_catalog_is_a_clean_list_of_real_addresses():
    names = [c[0] for c in bp.CATALOG]
    domains = [c[1] for c in bp.CATALOG]
    assert len(bp.CATALOG) >= 90 and len(set(domains)) == len(domains) and len(set(names)) == len(names)
    for name, domain, url, kind, tags, price in bp.CATALOG:
        host = (urlsplit(url).hostname or "").removeprefix("www.")
        assert url.startswith("https://") and (host == domain or host.endswith("." + domain)), name  # the start page is on the platform's own domain
        assert kind and tags.split() and price in (None, "free", "free plan", "paid"), name


def test_the_list_is_ranked_for_the_business_and_always_complete(client, shop):
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    d = client.get(base).json()
    assert d["total"] == len(bp.CATALOG) == len(d["items"]) and d["checked_at"] is None and d["stale"] is True  # no search key, no AI: the list is still all there
    order = [i["domain"] for i in d["items"]]
    for fashion in ("tumblr.com", "bloglovin.com", "womensweb.in", "medium.com"):  # fashion, lifestyle and Indian platforms come first for a clothing shop in India
        assert order.index(fashion) < order.index("hashnode.com") and order.index(fashion) < order.index("dev.to")
    assert order[0] in {"tumblr.com", "bloglovin.com", "womensweb.in", "vocal.media", "medium.com", "wordpress.com", "blogger.com", "flipboard.com", "issuu.com", "calameo.com", "yumpu.com"}
    # the same list for a business that is neither fashion nor Indian ranks those platforms lower
    other = client.post("/api/v1/businesses", json={"name": "Dental Co", "website": "https://dental.example/"}).json()["id"]
    a2 = Article(business_id=other, keyword="dental implants", status="completed", title="Implants", body="<p>x</p>")
    db.add(a2)
    db.commit()
    plain = {i["domain"]: i["fit"] for i in client.get(f"/api/v1/businesses/{other}/blog-flow/platforms/{a2.id}").json()["items"]}
    mine = {i["domain"]: i["fit"] for i in d["items"]}
    assert mine["womensweb.in"] > plain["womensweb.in"] and mine["bloglovin.com"] > plain["bloglovin.com"]


def test_platforms_are_checked_to_be_online_and_can_be_saved(client, shop, monkeypatch):
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    monkeypatch.setattr(bp, "_alive", lambda url: "livejournal.com" not in url)  # one platform has gone offline
    assert client.post(f"{base}/check").status_code == 202  # the test client runs the background task before it returns
    d = client.get(base).json()
    assert d["checked_at"] and d["stale"] is False and d["running"] is False
    by = {i["domain"]: i for i in d["items"]}
    assert by["livejournal.com"]["live"] is False and by["medium.com"]["live"] is True
    r = client.post(f"{base}/save", json={"domain": "bloglovin.com"})
    assert r.status_code == 200 and next(i for i in r.json()["items"] if i["domain"] == "bloglovin.com")["saved"] == "planned"
    assert client.post(f"{base}/save", json={"domain": "not-a-platform.example"}).status_code == 422
    other = client.post("/api/v1/businesses", json={"name": "Other"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{other}/blog-flow/platforms/{aid}").status_code == 404  # another project's article is not reachable


def test_claude_adds_the_platforms_that_suit_the_business_and_the_built_in_list_stays(client, shop, monkeypatch):
    from app.services import ai
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    asked = []
    import json
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: (asked.append(u), json.dumps({"platforms": [
        {"name": "WedMeGood", "domain": "www.wedmegood.com", "url": "https://www.wedmegood.com/blog", "kind": "Article site", "tags": ["fashion", "india", "nonsense"], "price": "free", "why": "Indian wedding readers rent lehengas"},
        {"name": "Tumblr", "domain": "tumblr.com", "url": "https://elsewhere.example/x", "kind": "Not a kind", "tags": ["fashion"], "price": "cheap", "why": "Fashion looks and lifestyle posts"},
        {"name": "Google", "domain": "google.com", "url": "https://google.com/", "kind": "Blog platform", "tags": ["general"]},   # a search engine: never
        {"name": "Not a domain", "domain": "nope", "kind": "Blog platform"},
        {"name": "Again", "domain": "wedmegood.com", "kind": "Article site"}]}))[1])  # the same platform twice
    monkeypatch.setattr(bp, "_alive", lambda url: True)
    assert client.post(f"{base}/check").status_code == 202
    d = client.get(base).json()
    assert d["source"] == "claude" and d["message"] == "" and "rental cloths" in asked[0] and "Pune" in asked[0]  # Claude is told what the business sells and where
    by = {i["domain"]: i for i in d["items"]}
    assert d["total"] == len(bp.CATALOG) + 1 and "google.com" not in by and "nope" not in by  # the built-in list plus one new platform
    w = by["wedmegood.com"]
    assert w["suggested"] and w["why"].startswith("Indian wedding") and w["tags"] == ["fashion", "india"] and w["price"] == "free" and w["live"] is True
    assert w["url"] == "https://www.wedmegood.com/blog" and w["rank"] == 0
    t = by["tumblr.com"]  # a built-in platform Claude also picked keeps its own address and kind, and gets the reason
    assert t["suggested"] and t["why"].startswith("Fashion looks") and t["url"] == "https://www.tumblr.com/" and t["kind"] == bp.BLOG
    assert not by["hashnode.com"]["suggested"] and by["hashnode.com"]["why"] == ""
    order = [i["domain"] for i in d["items"]]
    assert order.index("wedmegood.com") < order.index("tumblr.com") < order.index("bloglovin.com")  # Claude's first pick leads; the rest follow its order


def test_the_built_in_list_is_shown_when_claude_cannot_answer(client, shop, monkeypatch):
    from app.services import ai
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    monkeypatch.setattr(bp, "_alive", lambda url: True)
    monkeypatch.setattr(ai, "is_configured", lambda: False)  # no Claude key
    client.post(f"{base}/check")
    d = client.get(base).json()
    assert d["source"] == "built-in" and "not set up" in d["message"] and d["total"] == len(bp.CATALOG) and all(i["live"] is True for i in d["items"])
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: (_ for _ in ()).throw(RuntimeError("the AI is down")))
    client.post(f"{base}/check")
    d = client.get(base).json()
    assert d["source"] == "built-in" and "AI is down" in d["message"] and d["total"] == len(bp.CATALOG) and d["checked_at"]
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: "Sorry, I cannot do that.")  # an answer with no platforms in it
    client.post(f"{base}/check")
    d = client.get(base).json()
    assert d["source"] == "built-in" and "could not be read" in d["message"] and d["total"] == len(bp.CATALOG)


def test_a_long_answer_that_was_cut_off_keeps_every_complete_platform():
    """Claude's answer for 100 platforms can end in the middle of an entry: the platforms before the cut are used, not thrown away."""
    cut = ('{"platforms": [{"name": "A", "domain": "a.example", "kind": "Blog platform", "tags": ["general"], "why": "x"}, '
           '{"name": "B", "domain": "b.example", "kind": "Article site", "tags": ["fashion", "india"], "why": "y"}, '
           '{"name": "Wedding Sutra", "domain": "weddingsutra.com", "url": "https://www.weddingsutra.com/", "kind": "')
    got = bp._platform_objects(cut)
    assert [p["domain"] for p in got] == ["a.example", "b.example"]  # the entry that was cut is dropped; the one inside "tags" is not mistaken for a platform
    assert [p["domain"] for p in bp._platform_objects('{"platforms": [{"domain": "z.example"}]}')] == ["z.example"]  # a complete answer
    assert bp._platform_objects("no json here") == []


def _suited_cards(d):
    return [i for i in d["items"] if i.get("suits")]


def test_a_rental_business_has_its_suitable_platforms_marked_and_no_hard_coded_rental_websites(client, shop):
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    d = client.get(base).json()
    r = d["rental"]
    assert r["show"] is True and r["stale"] is True and r["items"] == [] and r["checked_at"] is None  # nothing until the search has run
    assert "medium.com" in [i["domain"] for i in d["items"]]  # Medium stays
    suited = {i["domain"] for i in _suited_cards(d)}
    assert {"womensweb.in", "medium.com", "tumblr.com", "blogger.com", "wordpress.com", "vocal.media"} <= suited  # fashion platforms that take articles from anyone
    assert not suited & {"hashnode.com", "dev.to", "bloglovin.com", "issuu.com", "pinterest.com", "behance.net", "shopify.com", "wix.com"}  # tech, directories, document sites, social, portfolios, site builders
    assert all("related" not in i for i in d["items"])  # no website is shown that was not found and verified
    assert next(i for i in d["items"] if i["domain"] == "womensweb.in")["url"] == "https://www.womensweb.in/"  # Start publishing still opens the platform itself


RENTAL_PAGE = "<html><head><title>{n}</title><meta name='description' content='Rent {w} dresses and lehengas online'></head><body><h1>{n}</h1></body></html>"


def _rental_web(monkeypatch):
    """A small web: twelve clothing-rental sites, one that opens but is about fashion news (no renting), and nothing else (anything else does not resolve)."""
    from app.services import backlink_checker as bc
    pages = {f"https://rent{n}.example/": RENTAL_PAGE.format(n=f"Rent{n}", w="wedding") for n in range(1, 13)}
    pages["https://vogue.example/"] = "<html><head><title>Vogue</title></head><body><h1>Fashion news</h1><p>Dresses and runway trends</p></body></html>"
    opened = []

    def fetch(url):
        opened.append(url)
        return (200, pages[url], url, 5, None) if url in pages else (None, "", None, 5, "Could not resolve hostname: " + url)
    monkeypatch.setattr(bc, "_fetch", fetch)
    return opened


def _site(n, why="Rents wedding dresses"):
    return {"name": f"Rent{n}", "domain": f"rent{n}.example", "why": why}


def test_two_searches_find_real_clothing_rental_websites_and_each_card_shows_a_different_set(client, shop, monkeypatch):
    import json

    from app.services import ai
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    asked = []

    def complete(system, user, **k):
        asked.append(user)
        if "Only rental businesses in or serving this city" in user:  # the local search
            return json.dumps({"sites": [_site(n) for n in range(1, 7)] + [
                {"name": "Vogue", "domain": "vogue.example", "why": "Fashion"},                 # opens, but it is about news, not renting
                {"name": "Invented", "domain": "invented-rental.example", "why": "x"},          # does not exist
                {"name": "Google", "domain": "google.com", "why": "x"}, {"name": "Bad", "domain": "nope"}]})
        return json.dumps({"sites": [_site(4)] + [_site(n) for n in range(7, 13)]})  # the wider search (Rent4 again: not repeated)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", complete)
    opened = _rental_web(monkeypatch)
    assert client.post(f"{base}/rental/refresh").status_code == 202  # the test client runs the background task before it returns
    assert len(asked) == 2 and "rental cloths" in asked[0] and "Pune" in asked[0] and "rent1.example" in asked[1]  # the second search is told what the first found
    r = client.get(base).json()["rental"]
    names = [s["name"] for s in r["items"]]
    assert names == [f"Rent{n}" for n in range(1, 13)]  # local ones first, then the wider ones; nothing hard-coded
    assert "Vogue" not in names and "Invented" not in names and "Google" not in names  # not about renting / not real / a search engine
    assert all(s["verified"] is True and s["why"] == "Rents wedding dresses" and s["url"] == f"https://{s['domain']}/" for s in r["items"])
    assert r["tried"] == 14 and r["message"] == "" and r["stale"] is False and "https://google.com/" not in opened
    # each platform card that suits the articles shows a different set of three
    cards = _suited_cards(client.get(base).json())
    sets = [tuple(s["name"] for s in c["related"]) for c in cards]
    assert len(cards) >= 6 and all(len(s) == 3 for s in sets)
    assert sets[0] == ("Rent1", "Rent2", "Rent3") and sets[1] == ("Rent4", "Rent5", "Rent6") and len(set(sets[:4])) == 4


def test_no_rental_website_is_shown_when_the_search_cannot_run(client, shop, monkeypatch):
    import json

    from app.services import ai
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    _rental_web(monkeypatch)
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    client.post(f"{base}/rental/refresh")
    d = client.get(base).json()
    assert d["rental"]["items"] == [] and "not set up" in d["rental"]["message"]
    assert _suited_cards(d) and all("related" not in c for c in _suited_cards(d))  # the platforms are still marked; no websites are made up
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: (_ for _ in ()).throw(RuntimeError("the AI is down")))
    client.post(f"{base}/rental/refresh")
    assert client.get(base).json()["rental"]["items"] == [] and "AI is down" in client.get(base).json()["rental"]["message"]
    # one search fails, the other works: what it found is still checked and shown
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: json.dumps({"sites": [_site(1), _site(2)]}) if "Only rental businesses" in u else (_ for _ in ()).throw(RuntimeError("busy")))
    client.post(f"{base}/rental/refresh")
    r = client.get(base).json()["rental"]
    assert [s["name"] for s in r["items"]] == ["Rent1", "Rent2"] and r["message"] == ""
    assert all([s["name"] for s in c["related"]] == ["Rent1", "Rent2"] for c in _suited_cards(client.get(base).json()))


def test_real_web_search_results_come_first_and_the_list_grows_run_after_run(client, shop, monkeypatch):
    import json

    from app.config import get_settings
    from app.services import ai
    from app.services import publish_discovery as pd
    bid, aid, db = shop
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{aid}"
    opened = _rental_web(monkeypatch)
    monkeypatch.setattr(get_settings(), "serper_api_key", "k")
    searched = []
    hits = [{"link": "https://www.rent9.example/lehenga", "title": "Rent9 | Lehenga on rent", "snippet": "Lehengas on rent in Pune"},
            {"link": "https://www.justdial.com/Pune/Dress-On-Rent", "title": "Justdial"},          # a directory, not a rental website
            {"link": "https://www.instagram.com/rentshop", "title": "Instagram"},                  # a social network
            {"link": "https://rentalshop.example/", "title": "Our own site"},                     # the business's own website
            {"link": "https://rent10.example/", "title": "Rent10 - Dress hire", "snippet": "Dress hire"}]
    monkeypatch.setattr(pd, "_search", lambda q, country: (searched.append(q), hits)[1])
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: json.dumps({"sites": [_site(1), _site(9)]}))  # Claude repeats one the search found
    client.post(f"{base}/rental/refresh")
    r = client.get(base).json()["rental"]
    assert "rental cloths Pune" in searched and "clothes on rent Pune" in searched  # what the business rents, in its city
    assert [(s["name"], s["found_by"]) for s in r["items"]] == [("Rent9", "web search"), ("Rent10", "web search"), ("Rent1", "Claude")]
    assert r["items"][0]["url"] == "https://rent9.example/" and not any("justdial" in u or "instagram" in u or "rentalshop" in u for u in opened)
    # the next run: the search service has no credits and Claude names other websites; the ones verified before are checked again and kept
    monkeypatch.setattr(pd, "_search", lambda q, country: (_ for _ in ()).throw(ValueError("The search service (Serper) has no credits left.")))
    monkeypatch.setattr(ai, "complete", lambda s, u, **k: json.dumps({"sites": [_site(2), _site(3)]}))
    client.post(f"{base}/rental/refresh")
    r = client.get(base).json()["rental"]
    assert [s["name"] for s in r["items"]] == ["Rent9", "Rent10", "Rent1", "Rent2", "Rent3"] and r["message"] == ""
    # a website that stops working is dropped at the next run
    from app.services import backlink_checker as bc
    real = bc._fetch
    monkeypatch.setattr(bc, "_fetch", lambda url: (None, "", None, 5, "Could not resolve hostname") if "rent10" in url else real(url))
    client.post(f"{base}/rental/refresh")
    assert [s["name"] for s in client.get(base).json()["rental"]["items"]] == ["Rent9", "Rent1", "Rent2", "Rent3"]


def test_a_website_is_verified_only_when_it_opens_and_is_about_renting_clothes(monkeypatch):
    from app.services import backlink_checker as bc
    site = {"name": "X", "domain": "x.example", "url": "https://x.example/", "kind": "Clothing Rental Website"}
    pages = {"rent+clothes": "<html><title>X</title><body><h1>Rent lehengas</h1></body></html>", "clothes only": "<html><title>X</title><body><h1>Buy dresses</h1></body></html>",
             "rent only": "<html><title>X</title><body><h1>Rent a car or a flat</h1></body></html>"}
    for label, html in pages.items():
        monkeypatch.setattr(bc, "_fetch", lambda url, h=html: (200, h, url, 5, None))
        assert bp._check_rental(site)["verified"] is (label == "rent+clothes"), label
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, "", url, 5, None))
    assert bp._check_rental(site)["verified"] is False  # an empty page
    monkeypatch.setattr(bc, "_fetch", lambda url: (404, "", url, 5, None))
    assert bp._check_rental(site)["verified"] is False and "404" in bp._check_rental(site)["error"]
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, pages["rent+clothes"], url, 5, None) if "www." in url else (None, "", None, 5, "The page could not be opened (ConnectError)."))
    assert bp._check_rental(site)["verified"] is True  # a site that only answers on the www name


def test_the_rental_websites_are_not_shown_to_a_business_that_does_not_rent(client):
    bid = client.post("/api/v1/businesses", json={"name": "Dental Co", "website": "https://dental.example/"}).json()["id"]
    db = SessionLocal()
    a = Article(business_id=bid, keyword="dental implants", status="completed", title="Implants", body="<p>x</p>")
    db.add(a)
    db.commit()
    base = f"/api/v1/businesses/{bid}/blog-flow/platforms/{a.id}"
    d = client.get(base).json()
    assert d["rental"] == {"show": False, "items": [], "checked_at": None, "stale": False, "running": False, "message": "", "tried": 0}
    assert not any(i.get("suits") or "related" in i for i in d["items"])  # no rental references and no "suits" mark for a business that does not rent
    assert client.post(f"{base}/rental/refresh").status_code == 409  # nothing is searched or opened for them
    assert client.post(f"{base}/save", json={"domain": "rooploop.com"}).status_code == 422  # a rental website is not a publishing destination
    db.close()


def test_a_platform_is_only_hidden_when_it_is_really_gone(monkeypatch):
    """Showing a live platform matters more than hiding a dead one: a timeout, a dropped connection or a blocked network says nothing about the platform."""
    from app.services import backlink_checker as bc

    def answers(status=None, err=None, per_url=None):
        monkeypatch.setattr(bc, "_fetch", lambda url: per_url[url] if per_url and url in per_url else (status, "", url, 5, err))

    for status, expected in ((200, True), (301, True), (403, True), (429, True), (404, False), (410, False), (500, None), (503, None)):
        answers(status)
        assert bp._alive("https://www.x.example/start") is expected, status
    answers(None, "The page took too long to answer.")
    assert bp._alive("https://www.x.example/") is None  # slow from here: unknown, still shown
    answers(None, "The page could not be opened (RemoteProtocolError).")
    assert bp._alive("https://www.x.example/") is None  # a site that drops our connection is not a dead site
    answers(None, "URL resolves to a disallowed network address (10.1.2.3); internal/private addresses are not allowed.")
    assert bp._alive("https://www.x.example/") is None  # this network's problem, not the platform's
    answers(None, "Could not resolve hostname: www.x.example")
    assert bp._alive("https://www.x.example/") is False  # the name is gone on every variant of the address
    answers(None, "Could not resolve hostname: nope", per_url={"https://x.example/": (200, "", "https://x.example/", 5, None)})
    assert bp._alive("https://www.x.example/start") is True  # only the "www." name is missing: the platform is there
    answers(404, per_url={"https://www.x.example/": (200, "", "https://www.x.example/", 5, None)})
    assert bp._alive("https://www.x.example/start") is True  # the start page moved but the site is up
    monkeypatch.setattr(bc, "_fetch", lambda url: (_ for _ in ()).throw(OSError("down")))
    assert bp._alive("https://www.x.example/") is None
