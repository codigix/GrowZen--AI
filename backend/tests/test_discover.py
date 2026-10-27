"""Finding a business from an email (website facts, free mailboxes, import + audit)."""
from app.services import discovery

SITE = """<html><head><title>Sai Dental Care | Dentist in Aundh, Pune</title>
<meta name="description" content="Family dental clinic in Aundh: implants, root canal, braces.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Sai Dental Care","telephone":"+91 98505 22140",
"address":{"@type":"PostalAddress","streetAddress":"Shop 12, ITI Road, Aundh","addressLocality":"Pune","postalCode":"411007"},
"geo":{"@type":"GeoCoordinates","latitude":18.5603,"longitude":73.8077},"sameAs":["https://facebook.com/saidental"]}</script></head>
<body><a href="https://instagram.com/saidental">Instagram</a><a href="https://maps.app.goo.gl/abc">Directions</a></body></html>"""


def test_facts_from_schema():
    f = discovery.extract_facts("https://saidentalcare.in", SITE)
    assert f["name"] == "Sai Dental Care" and f["schema_type"] == "Dentist"
    assert f["phone"] == "+91 98505 22140"
    assert f["address"] == "Shop 12, ITI Road, Aundh, Pune, 411007" and f["city"] == "Pune"
    assert (f["lat"], f["lng"]) == (18.5603, 73.8077)
    assert f["maps_link"] == "https://maps.app.goo.gl/abc"
    assert "https://instagram.com/saidental" in f["socials"]


def test_facts_without_schema():
    html = "<html><head><title>Zest Bakery - Cakes in Viman Nagar</title></head><body><a href='tel:9822010099'>Call</a><p>Phoenix Mall Road, Viman Nagar, Pune 411014</p></body></html>"
    f = discovery.extract_facts("https://zestbakery.co.in", html)
    assert f["name"] == "Zest Bakery" and f["phone"] == "+91 98220 10099"
    assert "411014" in f["address"]


def test_javascript_only_site():
    shell = '<html><head><title>Codigix Infotech</title></head><body><div id="root"></div><script src="/static/js/main.js"></script></body></html>'
    assert discovery.extract_facts("https://codigixinfotech.com", shell)["javascript_only"]
    from app.audit import crawler
    p = crawler.analyse_html("https://codigixinfotech.com/", 200, shell)
    assert [i["title"] for i in crawler.page_issues(p)] == ["/ is empty without JavaScript"]


def test_free_mailbox_asks_for_name(client):
    r = client.post("/api/v1/discover", json={"email": "owner.shreephysio@gmail.com"})
    d = r.json()
    assert r.status_code == 200 and d["free_mailbox"] and d["candidates"] == []
    assert any("business name" in n for n in d["notes"])


def test_bad_email(client):
    assert client.post("/api/v1/discover", json={"email": "not-an-email"}).status_code == 400


def test_business_domain_reads_website(client, monkeypatch):
    monkeypatch.setattr(discovery, "read_website", lambda domain: discovery.extract_facts(f"https://{domain}", SITE) | {"website": f"https://{domain}"})
    d = client.post("/api/v1/discover", json={"email": "info@saidentalcare.in"}).json()
    assert d["domain"] == "saidentalcare.in" and not d["places_enabled"]
    c = d["candidates"][0]
    assert c["source"] == "website" and c["name"] == "Sai Dental Care" and c["phone"] == "+91 98505 22140"


def test_website_or_name_without_email(client, monkeypatch):
    monkeypatch.setattr(discovery, "read_website", lambda domain: discovery.extract_facts(f"https://{domain}", SITE) | {"website": f"https://{domain}"})
    d = client.post("/api/v1/discover", json={"website": "https://www.saidentalcare.in/contact"}).json()
    assert d["domain"] == "saidentalcare.in" and d["email"] is None and d["candidates"][0]["name"] == "Sai Dental Care"
    named = client.post("/api/v1/discover", json={"name": "Sai Dental Care", "city": "Pune"}).json()
    assert named["candidates"] == [] and any("GOOGLE_PLACES_API_KEY" in n for n in named["notes"])
    assert client.post("/api/v1/discover", json={}).status_code == 400
    assert client.post("/api/v1/discover", json={"website": "not a site"}).status_code == 400


def test_import_creates_and_audits(client, monkeypatch):
    cand = {"source": "website", "name": "Glow Studio Unisex Salon", "phone": "+91 97300 88120", "website": "https://example-glow.in",
            "address": "2nd floor, Balewadi High Street, Baner, Pune, 411045", "category": "BeautySalon", "lat": 18.559, "lng": 73.786}
    r = client.post("/api/v1/discover/import", json={"email": "hello@example-glow.in", "candidate": cand, "plan": "Growth"})
    assert r.status_code == 201
    b = r.json()
    assert b["created"] and b["contact_email"] == "hello@example-glow.in" and b["plan"] == "Growth" and b["city"] == "Pune"
    kinds = {a["kind"] for a in client.get(f"/api/v1/businesses/{b['id']}/audits").json()}
    assert {"gbp", "technical", "onpage"} <= kinds  # audited in the background
    again = client.post("/api/v1/discover/import", json={"email": "hello@example-glow.in", "candidate": cand}).json()
    assert again["id"] == b["id"] and not again["created"]  # matched, not duplicated


# ── Name suggestions while typing, and the chosen one's details ─────────────
def _fake_http(monkeypatch, routes):
    """Answer httpx.get in the suggest service from `routes` (url prefix -> JSON)."""
    import httpx

    from app.services import suggest

    suggest._cache.clear()
    suggest._nominatim_last[0] = 0.0

    def fake_get(url, params=None, **kw):
        for prefix, payload in routes.items():
            if url.startswith(prefix):
                return httpx.Response(200, json=payload, request=httpx.Request("GET", url))
        raise AssertionError(f"unexpected request {url}")
    monkeypatch.setattr(suggest.httpx, "get", fake_get)


def test_google_suggestions_session_and_cached_details(client, monkeypatch):
    import httpx

    from app.config import get_settings
    from app.services import suggest
    monkeypatch.setattr(get_settings(), "google_places_api_key", "test-key")
    discovery._details_cache.clear()
    sent = {"autocomplete": [], "details": []}

    def fake_post(url, json=None, **kw):
        sent["autocomplete"].append(json)
        return httpx.Response(200, json={"suggestions": [{"placePrediction": {"placeId": "ChIJcodigix", "structuredFormat": {
            "mainText": {"text": "Codigix Infotech – Healthcare Marketing Agency"}, "secondaryText": {"text": "MIDC, Pimpri Colony, Pimpri-Chinchwad, Maharashtra, India"}}}}]},
            request=httpx.Request("POST", url))
    place = {"id": "ChIJcodigix", "displayName": {"text": "Codigix Infotech – Healthcare Marketing Agency"}, "businessStatus": "OPERATIONAL",
             "formattedAddress": "Office No: 514, 5th Floor, JRG3+PQG Brahma Sky Uzuri, MIDC, Pimpri Colony, Pimpri-Chinchwad, Maharashtra 411018, India",
             "nationalPhoneNumber": "070665 56768", "websiteUri": "https://codigix.co/", "rating": 4.7, "userRatingCount": 31,
             "location": {"latitude": 18.6268, "longitude": 73.8044}, "photos": [{}, {}],
             "addressComponents": [{"longText": "Pimpri Colony", "types": ["sublocality_level_1"]}, {"longText": "Pimpri-Chinchwad", "types": ["locality"]}, {"longText": "411018", "types": ["postal_code"]}]}

    def fake_get(url, params=None, **kw):
        if url.startswith(suggest.PHOTON):
            feats = [{"properties": {"name": f"Codigix branch {i}", "osm_type": "N", "osm_id": i, "osm_key": "office", "city": "Pune"}} for i in range(5)]
            return httpx.Response(200, json={"features": feats}, request=httpx.Request("GET", url))
        sent["details"].append(params)
        return httpx.Response(200, json=place, request=httpx.Request("GET", url))
    monkeypatch.setattr(suggest.httpx, "post", fake_post)
    monkeypatch.setattr(suggest.httpx, "get", fake_get)
    suggest._cache.clear()

    d = client.get("/api/v1/discover/suggest", params={"q": "codigix", "session": "sess-1"}).json()
    assert d["suggestions"][0]["source"] == "google_maps" and sent["autocomplete"][0]["sessionToken"] == "sess-1"
    assert sum(1 for s in d["suggestions"] if s["source"] == "openstreetmap") == 3  # Google first, OSM trimmed to 3
    c = client.post("/api/v1/discover/resolve", json={"source": "google_maps", "ref": "ChIJcodigix", "session": "sess-1"}).json()
    assert c["address"] == "Office No: 514, 5th Floor, Brahma Sky Uzuri, MIDC, Pimpri Colony, Pimpri-Chinchwad, Maharashtra 411018"  # no plus code / country
    assert (c["area"], c["city"], c["pincode"], c["rating"], c["photo_count"], c["status"]) == ("Pimpri Colony", "Pimpri-Chinchwad", "411018", 4.7, 2, "OPERATIONAL")
    assert sent["details"] == [{"sessionToken": "sess-1"}]  # the session closes with this details call
    b = client.post("/api/v1/discover/import", json={"candidate": c, "plan": "Growth"}).json()
    assert b["created"] and b["place_id"] == "ChIJcodigix" and len(sent["details"]) == 1  # import reused the cached details


def test_suggest_projects_and_openstreetmap(client, monkeypatch):
    from app.services import suggest
    bid = client.post("/api/v1/businesses", json={"name": "Codigix Infotech", "city": "Pune", "primary_category": "IT company"}).json()["id"]
    _fake_http(monkeypatch, {suggest.PHOTON: {"features": [
        {"properties": {"name": "Codigix Infotech Pvt Ltd", "osm_type": "N", "osm_id": 42, "osm_key": "office", "osm_value": "it", "district": "MIDC", "city": "Pimpri-Chinchwad", "state": "Maharashtra"}},
        {"properties": {"name": "Codigix Road", "osm_type": "W", "osm_id": 7, "osm_key": "highway", "osm_value": "residential", "city": "Pune"}},
        {"properties": {"name": "Codigix Infotech Pvt Ltd", "osm_type": "W", "osm_id": 43, "osm_key": "office", "osm_value": "it", "district": "MIDC", "city": "Pimpri-Chinchwad", "state": "Maharashtra"}},
    ]}})
    d = client.get("/api/v1/discover/suggest", params={"q": "codigix"}).json()
    sources = [(s["source"], s["title"]) for s in d["suggestions"]]
    assert ("project", "Codigix Infotech") in sources and d["suggestions"][0]["ref"] == str(bid)
    osm = [s for s in d["suggestions"] if s["source"] == "openstreetmap"]
    assert len(osm) == 1 and osm[0]["ref"] == "N42" and "Pimpri-Chinchwad" in osm[0]["subtitle"]  # roads and duplicates dropped
    assert d["sources"]["google_maps"] is False and client.get("/api/v1/discover/suggest", params={"q": "c"}).json()["suggestions"] == []


def test_resolve_openstreetmap_fills_location_and_website_facts(client, monkeypatch):
    from app.services import suggest
    _fake_http(monkeypatch, {suggest.NOMINATIM_LOOKUP: [{
        "name": "Codigix Infotech", "type": "it", "lat": "18.6298", "lon": "73.7997",
        "address": {"road": "Old Pune-Mumbai Highway", "suburb": "MIDC Pimpri", "city": "Pimpri-Chinchwad", "state": "Maharashtra", "postcode": "411018"},
        "extratags": {"website": "https://codigixinfotech.com", "opening_hours": "Mo-Sa 10:00-19:00", "email": "hello@codigixinfotech.com",
                      "wheelchair": "yes", "payment:upi": "yes", "contact:instagram": "https://instagram.com/codigix"}}]})
    monkeypatch.setattr(suggest, "read_website", lambda domain: {"phone": "+91 98220 10099", "description": "Healthcare marketing agency.", "socials": ["https://linkedin.com/x"]})
    c = client.post("/api/v1/discover/resolve", json={"source": "openstreetmap", "ref": "N42"}).json()
    assert (c["name"], c["area"], c["city"], c["pincode"]) == ("Codigix Infotech", "MIDC Pimpri", "Pimpri-Chinchwad", "411018")
    assert (c["lat"], c["lng"]) == (18.6298, 73.7997) and c["hours"] == ["Mo-Sa 10:00-19:00"]
    assert c["phone"] == "+91 98220 10099" and c["website_filled"] == ["phone", "description"] and c["maps_url"].endswith("/node/42")
    assert client.post("/api/v1/discover/resolve", json={"source": "openstreetmap", "ref": "bad"}).status_code == 400
    assert client.post("/api/v1/discover/resolve", json={"source": "google_maps", "ref": "ChIJ"}).status_code == 400  # no Places key

    assert c["email"] == "hello@codigixinfotech.com" and c["attributes"] == ["Accepts UPI", "Wheelchair accessible"]
    assert "https://instagram.com/codigix" in c["socials"] and "https://linkedin.com/x" in c["socials"]


def test_geocode_and_reverse(client, monkeypatch):
    from app.services import suggest
    place = {"lat": "18.5603", "lon": "73.8077", "display_name": "ITI Road, Aundh, Pune",
             "address": {"road": "ITI Road", "suburb": "Aundh", "city": "Pune", "state": "Maharashtra", "postcode": "411007"}}
    _fake_http(monkeypatch, {f"{suggest.NOMINATIM}/search": [place], f"{suggest.NOMINATIM}/reverse": place})
    g = client.get("/api/v1/discover/geocode", params={"q": "ITI Road Aundh Pune"}).json()["results"]
    assert g[0]["lat"] == 18.5603 and (g[0]["area"], g[0]["pincode"]) == ("Aundh", "411007")
    r = client.get("/api/v1/discover/reverse", params={"lat": 18.5603, "lng": 73.8077}).json()
    assert r["address"] == "ITI Road, Aundh, Pune, Maharashtra, 411007" and r["city"] == "Pune"
    assert client.get("/api/v1/discover/reverse", params={"lat": 123, "lng": 73}).status_code == 400
    assert client.get("/api/v1/discover/geocode", params={"q": "ab"}).json()["results"] == []


def test_nominatim_is_rate_limited_and_cached(monkeypatch):
    import time

    import httpx

    from app.services import suggest
    suggest._cache.clear()
    calls = []
    monkeypatch.setattr(suggest.httpx, "get", lambda url, params=None, **kw: calls.append(time.monotonic()) or httpx.Response(200, json=[{"lat": "1", "lon": "2", "address": {}}], request=httpx.Request("GET", url)))
    suggest.geocode("Baner Road Pune")
    suggest.geocode("Baner Road Pune")  # cached: no second request
    suggest.geocode("Aundh Road Pune")
    assert len(calls) == 2 and calls[1] - calls[0] >= 0.95  # at most one request per second
