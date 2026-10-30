"""Onboarding assistant: cross-checked fields, conflicts, problems found, and suggestions (rules and AI)."""
from app.services import ai, discovery, keywords
from app.services import onboard_assist as oa

MAPS = {"id": "p1", "displayName": {"text": "Sai Dental Care – Best Dentist Aundh"}, "nationalPhoneNumber": "098505 22140",
        "formattedAddress": "Shop 12, ITI Road, Aundh, Pune, Maharashtra 411007, India", "websiteUri": "https://saidentalcare.in/",
        "primaryTypeDisplayName": {"text": "Dentist"}, "businessStatus": "OPERATIONAL", "location": {"latitude": 18.56, "longitude": 73.81},
        "regularOpeningHours": {"weekdayDescriptions": ["Monday: 10 AM – 8 PM"]}, "googleMapsUri": "https://maps.google.com/?cid=1"}
SITE = {"website": "https://saidentalcare.in", "name": "Sai Dental Care", "phone": "+91 98505 22140", "address": "ITI Road, Aundh, Pune 411007",
        "schema_type": "Dentist", "description": "Family dental clinic in Aundh.", "headings": ["Dental implants", "Root canal treatment", "Braces"]}


def fakes(monkeypatch, maps=MAPS, site=SITE):
    monkeypatch.setattr(discovery, "places_enabled", lambda: True)
    monkeypatch.setattr(discovery, "place_details", lambda pid, session_token="", fresh=False: maps)
    monkeypatch.setattr(discovery, "_places_post", lambda q, limit=5, country=None: [maps])
    monkeypatch.setattr(discovery, "read_website", lambda domain: site)
    monkeypatch.setattr(keywords, "autocomplete", lambda q, gl="in": [(f"{q} for kids", 600), (f"{q} cost", 500), ("dentist costume", 400)] if "dentist" in q else [])


def form(**kw):
    return {"name": "Sai Dental Care", "primary_category": "", "description": "", "phone": "", "website": "", "address": "", "area": "Aundh", "city": "Pune", "services": []} | kw


def test_fields_are_cross_checked(client, monkeypatch):
    fakes(monkeypatch)
    r = client.post("/api/v1/discover/assist", json=form(phone="+91 98505 22140", website="saidentalcare.in", address="Main Road, Kothrud, Pune 411038", place_id="p1")).json()
    f = r["fields"]
    assert f["name"]["status"] == "verified" and f["name"]["best"] == "Sai Dental Care"  # what was typed, not the stuffed listing title
    assert f["phone"]["status"] == "verified" and sorted(f["phone"]["options"][0]["sources"]) == ["Google Maps", "typed", "website"]
    assert f["website"]["status"] == "verified"
    assert f["address"]["status"] == "conflict" and [o["sources"] for o in f["address"]["options"]] == [["Google Maps", "website"], ["typed"]]
    assert f["primary_category"]["status"] == "suggested" and f["primary_category"]["best"] == "Dentist"
    assert r["verified"] == 3 and r["conflicts"] == 1 and r["maps"]["matched"] == "listing" and r["website"]["read"]
    assert any("keyword stuffing" in c["text"] for c in r["checks"])  # the Maps title "– Best Dentist Aundh"


def test_suggestions_without_ai(monkeypatch):
    fakes(monkeypatch)
    s = oa.assist(form(), "p1")["suggestions"]
    assert s["category"] == {"value": "Dentist", "source": "Google Maps"}
    assert s["description"]["source"] == "template" and s["description"]["value"].startswith("Sai Dental Care is a dentist in Aundh, Pune.")
    assert s["keywords"]["source"] == "Google Autocomplete" and "dentist in aundh cost" in s["keywords"]["values"] and "dentist costume" not in s["keywords"]["values"]
    assert s["pin"] == {"lat": 18.56, "lng": 73.81} and s["hours"] == ["Monday: 10 AM – 8 PM"]


def test_generic_types_are_not_categories(monkeypatch):
    fakes(monkeypatch, maps=MAPS | {"displayName": {"text": "Codigix Infotech – Healthcare Marketing Agency"}, "primaryTypeDisplayName": {"text": "Services"}},
          site=SITE | {"schema_type": "Organization", "headings": []})
    r = oa.assist(form(name="Codigix Infotech"), "p1")
    assert r["fields"]["primary_category"]["status"] == "missing"
    assert r["suggestions"]["category"] == {"value": "Healthcare Marketing Agency", "source": "listing name"}


def test_problems_found(monkeypatch):
    fakes(monkeypatch, maps=MAPS | {"businessStatus": "CLOSED_TEMPORARILY"}, site=None)
    texts = " ".join(c["text"] for c in oa.assist(form(name="Best Dentist | Sai", phone="98505", website="saidentalcare.in", address="Aundh, Pune",
                                                         description="Call 98505 22140 or visit www.sai.in"), "p1")["checks"])
    for want in ["temporarily closed", "didn't answer", "keyword-stuffed", "10 digits", "PIN code", "link or phone number", "description is short"]:
        assert want in texts, want


def test_ai_suggestions(monkeypatch):
    fakes(monkeypatch)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: {
        "category": "Dental clinic", "services": ["Dental implants", "Root canal treatment", "Braces"],
        "description": "Sai Dental Care is a family dental clinic in Aundh, Pune, offering implants, root canal treatment and braces for children and adults. " * 3})
    s = oa.assist(form(services=["Teeth whitening"]), "p1")["suggestions"]
    assert s["category"] == {"value": "Dental clinic", "source": "AI"}
    assert s["services"]["values"] == ["Teeth whitening", "Dental implants", "Root canal treatment", "Braces"] and s["services"]["source"] == "AI"
    assert s["description"]["source"] == "AI" and len(s["description"]["value"]) <= 750
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: (_ for _ in ()).throw(RuntimeError("quota")))
    assert oa.assist(form(), "p1")["suggestions"]["category"]["source"] == "Google Maps"  # AI failing never breaks onboarding


def test_without_places_key(client, monkeypatch):
    monkeypatch.setattr(discovery, "read_website", lambda domain: None)
    monkeypatch.setattr(keywords, "autocomplete", lambda q, gl="in": [])
    r = client.post("/api/v1/discover/assist", json=form(phone="+91 98505 22140")).json()
    assert r["maps"]["matched"] is None and r["fields"]["phone"]["status"] == "only_typed" and r["fields"]["address"]["status"] == "missing"


def test_placeholder_category_and_stuffed_name(monkeypatch):
    fakes(monkeypatch, maps=MAPS | {"displayName": {"text": "Codigix Infotech – Healthcare Marketing Agency"}, "primaryTypeDisplayName": {"text": "Services"}},
          site=SITE | {"name": "Codigix Infotech", "schema_type": "Organization"})
    r = oa.assist(form(name="Codigix Infotech – Healthcare Marketing Agency", primary_category="Services"), "p1")
    assert r["fields"]["primary_category"]["status"] == "missing"  # "Services" is Google's placeholder, not a category
    assert r["suggestions"]["category"]["value"] == "Healthcare Marketing Agency"
    assert r["suggestions"]["name"] == {"value": "Codigix Infotech", "source": "website"}
    assert "is a services" not in r["suggestions"]["description"]["value"] and r["suggestions"]["description"]["value"].startswith("Codigix Infotech is a healthcare marketing agency")
