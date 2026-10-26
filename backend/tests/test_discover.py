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
    from app.services import crawler
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
