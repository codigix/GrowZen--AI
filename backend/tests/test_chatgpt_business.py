"""Your business, in ChatGPT: the record, validation, the catalog, the hosted feed (token, headers, CSV safety), JSON-LD, the agent starter, insights and privacy."""
import csv
import io
from datetime import date

from app.db import SessionLocal
from app.models import Business, CatalogItem, ChatGPTBusiness
from app.routers import chatgpt_business as router_mod
from app.services import chatgpt_business as svc

LONG = ("We rent designer lehengas, sherwanis and gowns for weddings and parties in Pune. " * 12).strip()


def _project(client, **extra):
    body = {"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "country": "IN", "phone": "+91 98765 43210", "website": "https://asharentals.in",
            "address": "12 MG Road, Pune", "description": LONG[:640], "services": [{"name": "Lehenga rental", "price": "Rs. 1,499", "description": "3-day rental"}, {"name": "Sherwani rental"}], **extra}
    r = client.post("/api/v1/businesses", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _url(bid, tail=""):
    return f"/api/v1/businesses/{bid}/chatgpt{tail}"


def _rows(model, bid):
    db = SessionLocal()
    try:
        return db.query(model).filter(model.business_id == bid).count()
    finally:
        db.close()


def _item(sku="LEH-1", **kw):
    return {"sku": sku, "title": "Lehenga rental", "price": "1,499.00", "product_url": "https://asharentals.in/lehenga", **kw}


# ---------- the record
def test_reading_gives_defaults_and_creates_nothing(client):
    bid = _project(client)
    d = client.get(_url(bid)).json()
    assert d["claim"]["status"] == "Unclaimed" and d["claim"]["verification_method"] is None and d["claim"]["persona_verified"] is False and d["claim"]["history"] == []
    assert d["profile"]["business_name"] == "" and d["defaults"]["business_name"] == "Asha Rentals" and d["defaults"]["website_url"] == "https://asharentals.in"
    assert 0 < len(d["defaults"]["description"]) <= 500 and d["defaults"]["description"].endswith(".")  # cut at the end of a sentence
    assert d["defaults"]["delivery_policy"] == "" and d["agent"] == {"is_enabled": False, "instructions": ""}
    assert d["limits"] == {"description_max": 500, "catalog_max": 1000, "instructions_max": 4000} and d["insights"] == []
    assert d["feed"]["csv_url"].endswith(".csv") and "/api/v1/chatgpt-business/public/feed/" in d["feed"]["csv_url"] and "/api/v1/public/feeds/chatgpt/" in d["feed"]["json_url"] and d["feed"]["items"] == 0 and d["feed"]["updated_at"] is None
    assert d["readiness"]["score"] == 0 and all({"key", "label", "done", "hint", "core"} <= set(i) for i in d["readiness"]["items"])
    assert _rows(ChatGPTBusiness, bid) == 0  # reading does not create the record


def test_update_validates_and_keeps_the_status_history(client):
    bid = _project(client)
    bad = lambda body: client.put(_url(bid), json=body).status_code  # noqa: E731
    assert bad({"profile": {"description": "x" * 501}}) == 422
    assert bad({"profile": {"business_name": "n" * 256}}) == 422
    assert bad({"profile": {"website_url": "javascript:alert(1)"}}) == 422
    assert bad({"profile": {"logo_url": "data:image/png;base64,AAA"}}) == 422
    assert bad({"profile": {"delivery_policy": "p" * 4001}}) == 422
    assert bad({"claim_status": "Maybe"}) == 422 and bad({"claim_status": "Locked"}) == 422 and bad({"verification_method": "Carrier_Pigeon"}) == 422
    assert bad({"dns_txt_record": "openai-verify=abc\nsecond line"}) == 422 and bad({"dns_txt_record": "t" * 501}) == 422
    assert bad({"agent": {"instructions": "i" * 4001}}) == 422 and bad({"agent": {"allowed_topics": ["Pricing"]}}) == 422  # the agent has only is_enabled and instructions
    assert bad({"unknown_field": 1}) == 422
    assert _rows(ChatGPTBusiness, bid) == 0  # rejected requests must not leave a half-made record behind
    # Persona follows an approved claim
    assert bad({"persona_verified": True}) == 422
    assert bad({"claim_status": "Claim_Pending", "persona_verified": True}) == 422
    ok = client.put(_url(bid), json={"claim_status": "Claim_Pending", "verification_method": "DNS_TXT", "dns_txt_record": "openai-domain-verification=abc123",
                                    "profile": {"business_name": "Asha Rentals", "category": "Clothing rental", "description": LONG[:300], "website_url": "https://asharentals.in", "logo_url": "https://asharentals.in/logo.png",
                                                "delivery_policy": "Pickup in store only.", "return_policy": "Return within 3 days."}})
    assert ok.status_code == 200, ok.text
    d = ok.json()
    assert d["claim"]["status"] == "Claim_Pending" and d["claim"]["verification_method"] == "DNS_TXT" and d["claim"]["dns_txt_record"] == "openai-domain-verification=abc123"
    assert d["profile"]["delivery_policy"] == "Pickup in store only." and [h["to"] for h in d["claim"]["history"]] == ["Claim_Pending"] and d["claim"]["history"][0]["from"] == "Unclaimed"
    assert d["claim"]["history"][0]["by"] and d["claim"]["history"][0]["at"]
    assert client.put(_url(bid), json={"claim_status": "Claim_Approved", "persona_verified": True}).status_code == 200  # the status change applies first
    d = client.get(_url(bid)).json()
    assert d["claim"]["persona_verified"] is True and [h["to"] for h in d["claim"]["history"]] == ["Claim_Pending", "Claim_Approved"]
    # Saving the same status again adds no history; moving the claim back clears the identity check
    client.put(_url(bid), json={"claim_status": "Claim_Approved"})
    assert len(client.get(_url(bid)).json()["claim"]["history"]) == 2
    d = client.put(_url(bid), json={"claim_status": "Disputed"}).json()
    assert d["claim"]["persona_verified"] is False and len(d["claim"]["history"]) == 3
    # Saving only part of the record leaves the rest alone
    assert client.put(_url(bid), json={"agent": {"is_enabled": True, "instructions": "Be polite."}}).json()["agent"] == {"is_enabled": True, "instructions": "Be polite."}
    assert client.get(_url(bid)).json()["profile"]["delivery_policy"] == "Pickup in store only."
    assert client.put(_url(bid), json={"profile": {"delivery_policy": ""}}).json()["profile"]["delivery_policy"] == ""


def test_readiness_is_four_equal_core_items(client):
    bid = _project(client)
    r0 = client.get(_url(bid)).json()["readiness"]
    assert [i["key"] for i in r0["items"]] == ["profile", "policies", "feed", "verification", "persona", "logo", "jsonld"]  # no 'agent' item while the agent is off
    assert [i["core"] for i in r0["items"]] == [True, True, True, True, False, False, False] and r0["score"] == 0 and not any(i["done"] for i in r0["items"][:6])
    score = lambda: client.get(_url(bid)).json()["readiness"]["score"]  # noqa: E731
    done = lambda: {i["key"]: i["done"] for i in client.get(_url(bid)).json()["readiness"]["items"]}  # noqa: E731
    # profile needs name, category, description and website, all four
    client.put(_url(bid), json={"profile": {"business_name": "Asha Rentals", "category": "Clothing rental", "description": "We rent outfits.", "website_url": ""}})
    assert score() == 0 and done()["profile"] is False
    client.put(_url(bid), json={"profile": {"website_url": "https://asharentals.in"}})
    assert score() == 25 and done()["profile"] is True  # a short description counts: it only has to be written
    client.put(_url(bid), json={"profile": {"delivery_policy": "Pickup."}})
    assert score() == 25 and done()["policies"] is False  # both policies are needed
    client.put(_url(bid), json={"profile": {"return_policy": "3 days."}})
    assert score() == 50
    client.post(_url(bid, "/catalog"), json={"items": [_item()]})
    assert score() == 75 and done()["feed"] is True
    # The extras are shown but never change the score
    client.put(_url(bid), json={"profile": {"logo_url": "https://asharentals.in/logo.png"}, "agent": {"is_enabled": True}})
    d = done()
    assert d["logo"] is True and d["agent"] is False and score() == 75
    assert [i["core"] for i in client.get(_url(bid)).json()["readiness"]["items"] if i["key"] in ("persona", "logo", "jsonld", "agent")] == [False] * 4
    # verification needs an approved claim AND a method
    client.put(_url(bid), json={"claim_status": "Claim_Approved"})
    assert score() == 75 and done()["verification"] is False
    client.put(_url(bid), json={"verification_method": "Business_Email"})
    assert score() == 100 and done()["verification"] is True
    client.put(_url(bid), json={"claim_status": "Disputed"})
    assert score() == 75
    client.put(_url(bid), json={"claim_status": "Claim_Approved", "persona_verified": True, "agent": {"instructions": "Be polite."}})
    d = done()
    assert d["persona"] is True and d["agent"] is True and score() == 100


# ---------- catalog
def test_catalog_upsert_partial_errors_and_caps(client):
    bid = _project(client)
    r = client.post(_url(bid, "/catalog"), json={"items": [
        _item("A-1"), _item("A-2", price=499, availability="preorder", currency="usd", image_url="https://asharentals.in/a2.jpg"),
        _item("A-1", title="again"),  # duplicate inside the upload
        {"sku": "bad sku!", "title": "x", "price": 1, "product_url": "https://x.in"},
        _item("A-3", price="abc"), _item("A-4", price=-5), _item("A-5", product_url="javascript:alert(1)"), _item("A-6", availability="sold"), _item("A-7", currency="RUPEES"),
        {"sku": "A-8", "title": "", "price": 1, "product_url": "https://x.in"}, "not an object"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["added"] == 2 and out["updated"] == 0 and out["total"] == 2
    assert {e["row"] for e in out["errors"]} == {3, 4, 5, 6, 7, 8, 9, 10, 11} and all(e["error"] for e in out["errors"]) and next(e for e in out["errors"] if e["row"] == 3)["sku"] == "A-1"
    items = client.get(_url(bid, "/catalog")).json()
    assert items["total"] == 2 and items["items"][0]["price"] == 1499.0 and items["items"][1]["currency"] == "USD" and items["items"][1]["availability"] == "preorder"
    # Same SKU again updates it
    up = client.post(_url(bid, "/catalog"), json={"items": [_item("A-1", title="Lehenga, new title", price=1799)]}).json()
    assert up["added"] == 0 and up["updated"] == 1 and up["total"] == 2
    assert next(i for i in client.get(_url(bid, "/catalog")).json()["items"] if i["sku"] == "A-1")["title"] == "Lehenga, new title"
    assert client.delete(_url(bid, "/catalog/A-2")).json() == {"ok": True, "total": 1} and client.delete(_url(bid, "/catalog/NOPE")).status_code == 404
    # A batch over 500 is refused; the feed holds at most 1000 items
    assert client.post(_url(bid, "/catalog"), json={"items": [_item(f"B-{i}") for i in range(501)]}).status_code == 422
    for start in (0, 500):
        assert client.post(_url(bid, "/catalog"), json={"items": [_item(f"C-{i}") for i in range(start, start + 500)]}).json()["errors"] == [] or start == 500
    full = client.get(_url(bid, "/catalog")).json()["total"]
    assert full == 1000
    over = client.post(_url(bid, "/catalog"), json={"items": [_item("Z-1"), _item("C-1", title="edit of an existing one")]}).json()
    assert over["added"] == 0 and over["updated"] == 1 and over["errors"][0]["row"] == 1 and "maximum" in over["errors"][0]["error"] and over["total"] == 1000


def test_catalog_from_services_never_invents_a_price(client):
    bid = _project(client)
    out = client.post(_url(bid, "/catalog/from-services")).json()
    assert out["added"] == 1 and out["total"] == 1
    assert [e["sku"] for e in out["errors"]] == ["sherwani-rental"] and "price" in out["errors"][0]["error"].lower()  # the service with no price is reported, not listed at 0
    item = client.get(_url(bid, "/catalog")).json()["items"][0]
    assert item["sku"] == "lehenga-rental" and item["price"] == 1499.0 and item["currency"] == "INR" and item["product_url"] == "https://asharentals.in" and item["description"] == "3-day rental"
    # A second run leaves an edited item alone
    client.post(_url(bid, "/catalog"), json={"items": [_item("lehenga-rental", title="My own title", price=2000)]})
    again = client.post(_url(bid, "/catalog/from-services")).json()
    assert again["added"] == 0 and again["skipped"] == 1
    assert client.get(_url(bid, "/catalog")).json()["items"][0]["title"] == "My own title"


# ---------- the hosted feed
def test_feed_is_public_scoped_and_safe(client):
    a, b2 = _project(client), _project(client, name="Other Boutique")
    client.post(_url(a, "/catalog"), json={"items": [_item("A-1", title="=HYPERLINK(\"http://evil\")", description="Line one,\nline \"two\""), _item("A-2", title="+SUM(1)", price="499"), _item("A-3", title="@cmd", image_url="https://a.in/i.jpg"),
                                                     _item("A-4", title="-1+1", availability="out_of_stock")]})
    client.post(_url(b2, "/catalog"), json={"items": [_item("B-ONLY", title="Secret other item")]})
    urls = client.get(_url(a)).json()["feed"]
    token = urls["json_url"].rsplit("/", 1)[1][:-5]
    assert token == svc.token_for(a) and urls["items"] == 4 and urls["updated_at"]
    from fastapi.testclient import TestClient
    from app.main import app
    anon = TestClient(app)  # the feed needs no sign-in: a client with no session
    j = anon.get(urls["json_url"].replace("http://localhost:8000", ""))
    assert j.status_code == 200 and j.headers["cache-control"] == "public, max-age=300" and j.headers["x-robots-tag"] == "noindex" and j.headers["x-content-type-options"] == "nosniff"
    body = j.json()
    assert body["business"] == {"name": "Asha Rentals", "url": "https://asharentals.in"} and body["generated_at"] and body["currency"] == "INR"
    assert [i["id"] for i in body["items"]] == ["A-1", "A-2", "A-3", "A-4"] and set(body["items"][0]) == {"id", "title", "description", "link", "image_link", "price", "availability"}
    assert body["items"][1]["price"] == "499.00 INR" and body["items"][3]["availability"] == "out_of_stock" and "Secret other item" not in j.text
    c = anon.get(urls["csv_url"].replace("http://localhost:8000", ""))
    assert c.status_code == 200 and c.headers["content-type"].startswith("text/csv") and c.headers["x-robots-tag"] == "noindex" and "Secret other item" not in c.text
    rows = list(csv.reader(io.StringIO(c.text)))
    assert rows[0] == ["id", "title", "description", "link", "image_link", "price", "availability"] and len(rows) == 5
    assert rows[1][1] == "'=HYPERLINK(\"http://evil\")" and rows[2][1] == "'+SUM(1)" and rows[3][1] == "'@cmd" and rows[4][1] == "'-1+1"  # a spreadsheet would run these as formulas
    assert rows[1][2] == 'Line one,\nline "two"' and rows[3][4] == "https://a.in/i.jpg"  # RFC 4180 quoting round-trips
    # Wrong tokens, wrong ids and wrong names all answer the same
    api = "/api/v1/public/feeds/chatgpt/"
    for bad in (f"{a}-0000000000000000.json", f"999999-{'a' * 16}.json", "garbage.json", f"{token}.xml", f"{token}", f"{a}-{token.split('-')[1][:-1]}{'1' if token[-1] == '0' else '0'}.csv", f"{token}.JSON"):
        assert anon.get(api + bad).status_code == 404, bad
    # The same CSV is also served at /chatgpt-business/public/feed/<token>.csv (CSV only), same headers, same signed token
    alias = anon.get("/api/v1/chatgpt-business/public/feed/" + token + ".csv")
    assert alias.status_code == 200 and alias.text == c.text and alias.headers["cache-control"] == "public, max-age=300" and alias.headers["x-robots-tag"] == "noindex" and alias.headers["x-content-type-options"] == "nosniff"
    assert urls["csv_url"].replace("http://localhost:8000", "") == "/api/v1/chatgpt-business/public/feed/" + token + ".csv" and anon.get(urls["csv_url"].replace("http://localhost:8000", "")).text == c.text
    for bad in (token + ".json", token, f"{a}.csv", "garbage.csv", f"999999-{'a' * 16}.csv", f"{a}-{token.split('-')[1][:-1]}{'1' if token[-1] == '0' else '0'}.csv"):
        assert anon.get("/api/v1/chatgpt-business/public/feed/" + bad).status_code == 404, bad
    # Another business's token shows only that business's items
    other = anon.get(api + svc.token_for(b2) + ".json").json()
    assert [i["id"] for i in other["items"]] == ["B-ONLY"]
    # An empty catalog is a valid, empty feed
    empty = _project(client, name="Empty Co")
    assert anon.get(api + svc.token_for(empty) + ".json").json()["items"] == [] and anon.get(api + svc.token_for(empty) + ".csv").text.strip() == "id,title,description,link,image_link,price,availability"


def test_feed_is_rate_limited_per_address(client, monkeypatch):
    bid = _project(client)
    router_mod._hits.clear()
    monkeypatch.setattr(router_mod, "FEED_LIMIT", 5)
    url = "/api/v1/public/feeds/chatgpt/" + svc.token_for(bid) + ".json"
    alias = "/api/v1/chatgpt-business/public/feed/" + svc.token_for(bid) + ".csv"
    assert [client.get(url).status_code for _ in range(3)] == [200] * 3 and [client.get(alias).status_code for _ in range(4)] == [200] * 2 + [429] * 2  # one budget for both addresses
    router_mod._hits.clear()


# ---------- structured data and agent
def _walk(x):
    if isinstance(x, dict):
        for v in x.values():
            yield from _walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from _walk(v)
    else:
        yield x


def test_jsonld_is_real_data_only(client):
    bid = _project(client, contact_email="owner@asharentals.in", lat=18.52, lng=73.85, hours={"periods": [{"openDay": "MONDAY", "openTime": {"hours": 9}, "closeDay": "MONDAY", "closeTime": {"hours": 18, "minutes": 30}},
                                                                                                          {"openDay": "SUNDAY", "openTime": {"hours": 0}, "closeDay": "SUNDAY", "closeTime": {"hours": 24}}]},
                  social_accounts={"facebook": "facebook.com/asharentals", "instagram": "@asha.rentals"})
    d = client.get(_url(bid, "/jsonld")).json()
    ld = d["jsonld"]
    assert ld["@context"] == "https://schema.org" and ld["@type"] == "ClothingStore" and ld["name"] == "Asha Rentals" and ld["url"] == "https://asharentals.in" and ld["telephone"] == "+91 98765 43210"
    assert ld["email"] == "owner@asharentals.in" and ld["address"]["streetAddress"] == "12 MG Road, Pune" and ld["address"]["addressCountry"] == "IN" and ld["geo"]["latitude"] == 18.52
    assert ld["openingHoursSpecification"][0] == {"@type": "OpeningHoursSpecification", "dayOfWeek": "Monday", "opens": "09:00", "closes": "18:30"} and ld["openingHoursSpecification"][1]["closes"] == "23:59"
    assert any(u.endswith("facebook.com/asharentals") for u in ld["sameAs"]) and any(u.endswith("instagram.com/asha.rentals") for u in ld["sameAs"])
    assert "aggregateRating" not in ld  # Google reported no rating: none is invented
    assert None not in list(_walk(ld)) and "" not in list(_walk(ld)) and '"aggregateRating"' not in d["text"] and d["text"].startswith("{")
    assert any("logo" in w.lower() for w in d["warnings"])
    # A real rating from Google, a catalog and a saved logo
    db = SessionLocal()
    biz = db.get(Business, bid)
    biz.rating, biz.review_count, biz.gbp_status = 4.8, 31, {"maps_url": "https://maps.google.com/?cid=1"}
    db.commit(); db.close()
    client.put(_url(bid), json={"profile": {"logo_url": "https://asharentals.in/logo.png"}})
    client.post(_url(bid, "/catalog"), json={"items": [_item("A-1", availability="limited"), _item("A-2", price=0)]})
    ld = client.get(_url(bid, "/jsonld")).json()["jsonld"]
    assert ld["aggregateRating"] == {"@type": "AggregateRating", "ratingValue": 4.8, "reviewCount": 31} and "https://maps.google.com/?cid=1" in ld["sameAs"] and ld["logo"] == "https://asharentals.in/logo.png"
    offers = ld["hasOfferCatalog"]["itemListElement"]
    assert offers[0]["price"] == "1499.00" and offers[0]["priceCurrency"] == "INR" and offers[0]["availability"] == "https://schema.org/LimitedAvailability" and offers[1]["price"] == "0.00"
    assert None not in list(_walk(ld)) and "" not in list(_walk(ld))
    # No street address: an Organization, with the reason in the warnings
    nb = _project(client, name="Online Only Co", address="")
    o = client.get(_url(nb, "/jsonld")).json()
    assert o["jsonld"]["@type"] == "Organization" and "address" not in o["jsonld"] and any("Organization" in w for w in o["warnings"])
    plain = _project(client, name="Odd Trades", primary_category="Industrial widgets")
    assert client.get(_url(plain, "/jsonld")).json()["jsonld"]["@type"] == "LocalBusiness"


def test_agent_guidelines_use_the_real_policies(client):
    bid = _project(client, contact_email="owner@asharentals.in")
    g0 = client.get(_url(bid, "/agent-guidelines")).json()["text"]
    assert "Asha Rentals" in g0 and "Lehenga rental" in g0 and "Delivery: not provided" in g0 and "Returns: not provided" in g0 and "+91 98765 43210" in g0 and "owner@asharentals.in" in g0
    assert "Never invent prices" in g0 and "medical, legal or financial advice" in g0 and "refunds" in g0
    client.put(_url(bid), json={"profile": {"delivery_policy": "Free pickup in Aundh.", "return_policy": "Return within 3 days."}})
    g1 = client.get(_url(bid, "/agent-guidelines")).json()["text"]
    assert "Delivery: Free pickup in Aundh." in g1 and "Returns: Return within 3 days." in g1 and "not provided" not in g1 and "WHAT YOU HELP WITH" in g1 and "TOPICS" not in g1


# ---------- insights
def test_insights_are_logged_per_month(client):
    bid = _project(client)
    this_month = date.today().strftime("%Y-%m")
    nxt = f"{date.today().year + 1}-01"
    ok = client.post(_url(bid, "/insights"), json={"month": "2026-10", "mentions": 14, "website_clicks": 5, "topics": ["wedding lehenga", "wedding lehenga", " sherwani "]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["insights"] == [{"month": "2026-10", "mentions": 14, "website_clicks": 5, "topics": ["wedding lehenga", "sherwani"]}]
    client.post(_url(bid, "/insights"), json={"month": "2026-09", "mentions": 3, "website_clicks": 0, "topics": []})
    again = client.post(_url(bid, "/insights"), json={"month": "2026-10", "mentions": 20, "website_clicks": 9}).json()["insights"]
    assert [i["month"] for i in again] == ["2026-09", "2026-10"] and again[1]["mentions"] == 20 and again[1]["topics"] == []  # ascending, one per month, the second save replaced the first
    assert client.get(_url(bid)).json()["insights"] == again
    assert client.post(_url(bid, "/insights"), json={"month": this_month, "mentions": 1, "website_clicks": 1}).status_code == 200
    for bad in ({"month": nxt, "mentions": 1, "website_clicks": 1}, {"month": "2026-13", "mentions": 1, "website_clicks": 1}, {"month": "10-2026", "mentions": 1, "website_clicks": 1},
                {"month": "2026-08", "mentions": -1, "website_clicks": 1}, {"month": "2026-08", "mentions": 1, "website_clicks": -1}, {"month": "2026-08", "mentions": "many", "website_clicks": 1},
                {"month": "2026-08", "mentions": 1, "website_clicks": 1, "topics": [f"t{i}" for i in range(11)]}, {"month": "2026-08", "mentions": 1, "website_clicks": 1, "topics": ["x" * 81]}):
        assert client.post(_url(bid, "/insights"), json=bad).status_code == 422, bad
    left = client.delete(_url(bid, "/insights/2026-09")).json()["insights"]
    assert "2026-09" not in [i["month"] for i in left] and client.delete(_url(bid, "/insights/2026-09")).status_code == 404


# ---------- privacy
def _forget_users(*emails):
    """Remove the users a test made, with their projects: SQLite hands out freed ids again, so leftovers would change which user id the next test gets."""
    from app.models import AppUser
    db = SessionLocal()
    try:
        users = db.query(AppUser).filter(AppUser.email.in_(emails)).all()
        ids = [str(u.id) for u in users]
        biz = [b.id for b in db.query(Business).filter(Business.owner_id.in_(ids))] if ids else []
        if biz:
            db.query(CatalogItem).filter(CatalogItem.business_id.in_(biz)).delete(synchronize_session=False)
            db.query(ChatGPTBusiness).filter(ChatGPTBusiness.business_id.in_(biz)).delete(synchronize_session=False)
            db.query(Business).filter(Business.id.in_(biz)).delete(synchronize_session=False)
        for u in users:
            db.delete(u)
        db.commit()
    finally:
        db.close()


def test_overview_and_every_route_are_private_to_the_owner(client):
    from test_security import login, user
    user("cgpt1@x.in", "editor")
    user("cgpt2@x.in", "editor")
    mine, _ = login("cgpt1@x.in")
    theirs, _ = login("cgpt2@x.in")
    try:
        a = mine.post("/api/v1/businesses", json={"name": "Mine Co", "city": "Pune"}).json()["id"]
        b = theirs.post("/api/v1/businesses", json={"name": "Theirs Co", "city": "Pune"}).json()["id"]
        mine.put(_url(a), json={"claim_status": "Claim_Pending", "verification_method": "Shopify"})
        mine.post(_url(a, "/catalog"), json={"items": [_item("M-1")]})
        ov = mine.get("/api/v1/chatgpt/overview").json()
        assert [o["name"] for o in ov] == ["Mine Co"] and ov[0]["claim_status"] == "Claim_Pending" and ov[0]["verification_method"] == "Shopify" and ov[0]["items"] == 1
        assert set(ov[0]) == {"business_id", "name", "claim_status", "verification_method", "persona_verified", "items", "readiness_score", "updated_at"} and ov[0]["updated_at"]
        assert [o["name"] for o in theirs.get("/api/v1/chatgpt/overview").json()] == ["Theirs Co"]
        for method, tail, body in (("get", "", None), ("put", "", {"claim_status": "Disputed"}), ("get", "/catalog", None), ("post", "/catalog", {"items": [_item("X-1")]}), ("delete", "/catalog/M-1", None),
                                   ("post", "/catalog/from-services", None), ("get", "/jsonld", None), ("get", "/agent-guidelines", None),
                                   ("post", "/insights", {"month": "2026-10", "mentions": 1, "website_clicks": 1}), ("delete", "/insights/2026-10", None)):
            r = getattr(theirs, method)(_url(a, tail), **({"json": body} if body is not None else {}))
            assert r.status_code == 404, (method, tail, r.status_code)
        assert mine.get(_url(a)).json()["claim"]["status"] == "Claim_Pending"  # untouched
        assert _rows(CatalogItem, a) == 1 and _rows(CatalogItem, b) == 0
        # Not signed in at all: the private routes refuse, the feed still works
        theirs.cookies.clear()
        assert theirs.get(_url(a)).status_code in (401, 403) and theirs.get("/api/v1/chatgpt/overview").status_code in (401, 403)
        assert theirs.get("/api/v1/public/feeds/chatgpt/" + svc.token_for(a) + ".json").status_code == 200
    finally:
        _forget_users("cgpt1@x.in", "cgpt2@x.in")

