"""Competitor research (app/competitors/intel.py): Google results are faked, sites are fake pages."""
from types import SimpleNamespace

import pytest

from app.competitors import intel
from app.config import get_settings
from app.services.crawler import analyse_html

KEYWORDS = ["dentist in Baner", "dentist in Pune"]


def _page(url, title, h1, words=300, links=(), schema=None):
    body = " ".join(["teeth"] * words)
    nav = "".join(f'<a href="{h}">{t}</a>' for h, t in links)
    ld = f'<script type="application/ld+json">{{"@type": "{schema}"}}</script>' if schema else ""
    return analyse_html(url, 200, f"<html><head><title>{title}</title>{ld}</head><body><h1>{h1}</h1>{nav}<p>{body}</p></body></html>")


SITES = {
    "smilecare.in": [
        _page("https://smilecare.in/", "Smile Care | Best Dentist in Baner, Pune", "Dentist in Baner", 900,
              [("https://smilecare.in/services/implants", "Dental Implants"), ("https://smilecare.in/services/braces", "Braces"),
               ("https://smilecare.in/aundh", "Dentist in Aundh"), ("https://smilecare.in/blog/", "Blog"), ("https://smilecare.in/contact", "Contact Us"),
               ("https://smilecare.in/mumbai", "Mumbai"), ("https://smilecare.in/x", "View More")], schema="Dentist"),
        _page("https://smilecare.in/services/implants", "Dental Implants in Pune | Smile Care", "Dental Implants", 1100),
    ],
    "toothfairy.com": [_page("https://toothfairy.com/", "Tooth Fairy Dental Clinic Hyderabad", "Dental clinic in Hyderabad", 150)],
    "mydental.in": [_page("https://mydental.in/", "My Dental", "Welcome", 200)],
}


def fake_call(self, path, body):
    q = body["q"]
    if path == "/places":
        return {"places": [
            {"position": 1, "title": "Smile Care Dental", "rating": 4.8, "ratingCount": 900, "website": "https://smilecare.in/", "address": "12, FC Road, Baner, Pune, Maharashtra 411045", "cid": "1"},
            {"position": 2, "title": "My Dental", "rating": 4.2, "ratingCount": 40, "website": "https://mydental.in/", "address": "4, Main St, Baner, Pune, Maharashtra 411045", "cid": "2"},
        ]}
    if q == "dentist in Baner":
        return {"organic": [
            {"position": 1, "link": "https://www.practo.com/pune/dentist/baner", "title": "Dentists in Baner - Practo"},
            {"position": 2, "link": "https://smilecare.in/", "title": "Smile Care"},
            {"position": 3, "link": "https://toothfairy.com/", "title": "Tooth Fairy"},
        ], "peopleAlsoAsk": [{"question": "How much does a root canal cost in Pune?"}]}
    if q == "dentist in Pune":
        return {"organic": [
            {"position": 1, "link": "https://smilecare.in/services/implants", "title": "Smile Care"},
            {"position": 4, "link": "https://mydental.in/", "title": "My Dental"},
            {"position": 5, "link": "https://www.justdial.com/Pune/Dentists", "title": "Justdial"},
        ]}
    # Listing / mention searches by name.
    if "Smile Care" in q or "smilecare" in q:
        return {"organic": [{"link": "https://www.practo.com/pune/clinic/smile-care-baner", "title": "Smile Care Dental Clinic - Practo"},
                            {"link": "https://www.justdial.com/Pune/Smile-Care", "title": "Smile Care Dental in Baner - Justdial"},
                            {"link": "https://unrelated.com/x", "title": "Something else entirely"}]}
    if "My Dental" in q:
        return {"organic": [{"link": "https://www.justdial.com/Pune/My-Dental", "title": "My Dental - Justdial"}]}
    return {"organic": []}


@pytest.fixture
def faked(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "test-key")
    get_settings.cache_clear()
    intel._cache.clear()
    monkeypatch.setattr(intel.Serper, "call", fake_call)
    monkeypatch.setattr(intel, "scan_site", lambda url, **kw: {"url": url, "host": intel.host_of(url), "pages": SITES.get(intel.host_of(url), [])})
    yield
    get_settings.cache_clear()


def test_default_keywords_name_the_place():
    b = SimpleNamespace(name="X", primary_category="Dentist", secondary_categories=[], services=[{"name": "Teeth whitening"}], area="Baner, Pune", city="Pune")
    kws = intel.default_keywords(b)
    assert kws[:3] == ["dentist in Baner", "dentist in Pune", "best dentist in Pune"]
    assert "teeth whitening in Baner" in kws and len(kws) <= 6


def test_needs_a_serper_key(monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(intel.IntelError, match="SERPER_API_KEY"):
        intel.Serper()
    get_settings.cache_clear()


def test_analysis_positions_gaps_and_strategy(faked):
    me = SimpleNamespace(id=1, name="My Dental", website="https://mydental.in", phone="", area="Baner", city="Pune",
                         primary_category="Dentist", secondary_categories=[], services=[], rating=4.2, review_count=40)
    r = intel.analyse(me, KEYWORDS, "Pune, India")

    # Your own positions: organic #4 for one keyword, Maps #2 for both.
    assert r["you"]["positions"] == {"dentist in Pune": 4}
    assert r["you"]["local"] == {"dentist in Baner": 2, "dentist in Pune": 2}
    assert r["summary"]["keywords_ranked"] == 1 and r["summary"]["keywords_total"] == 2

    # Competitors by visibility; listing sites are marked, the business itself is left out.
    doms = {d["domain"]: d for d in r["organic_competitors"]}
    assert "mydental.in" not in doms
    assert doms["practo.com"]["type"] == "directory" and doms["smilecare.in"]["type"] == "business"
    assert doms["smilecare.in"]["positions"] == {"dentist in Baner": 2, "dentist in Pune": 1}
    assert r["summary"]["leader"]["domain"] == "smilecare.in"
    assert r["local_competitors"][0]["name"] == "Smile Care Dental"

    # What the leader does on its site.
    smile = next(p for p in r["profiles"] if p["domain"] == "smilecare.in")
    site = smile["site"]
    assert "Dental Implants" in site["services"] and "Braces" in site["services"]
    assert "Contact Us" not in site["services"] and "View More" not in site["services"] and "Mumbai" not in site["services"]
    assert "Dentist in Aundh" not in site["services"]
    assert site["blog"] is True and "Dentist" in site["schema"]
    assert "best dentist in baner pune" in site["target_keywords"]
    assert not any("smile care" in k for k in site["target_keywords"])  # the brand is not a keyword
    assert {s["domain"] for s in smile["link_sources"]} == {"practo.com", "justdial.com"}  # only results about the brand
    assert any("Listed on practo.com" in line for line in smile["strategy"])
    assert any("Separate pages for its services" in line for line in smile["strategy"])

    # Another city's site: its phrases are not ideas for this business.
    assert not any("hyderabad" in k for k in r["ideas"]["competitor_keywords"])
    assert r["ideas"]["questions"] == ["How much does a root canal cost in Pune?"]

    # Gaps: no top-10 page for "dentist in Baner"; competitors are on Practo, this business is not.
    assert [g["keyword"] for g in r["gaps"]["keywords"]] == ["dentist in Baner"]
    assert "practo.com" in [g["domain"] for g in r["gaps"]["listings"]]
    assert "justdial.com" not in [g["domain"] for g in r["gaps"]["listings"]]
    titles = [a["title"] for a in r["actions"]]
    assert 'Build or improve a page for "dentist in Baner"' in titles
    assert "Close the review gap" in titles
    assert any(t.startswith("Get listed on practo.com") for t in titles)
    assert "Add LocalBusiness structured data" in titles  # Smile Care uses Dentist schema, My Dental none


def test_api_runs_in_the_background(client, faked):
    bid = client.post("/api/v1/businesses", json={"name": "My Dental", "primary_category": "Dentist", "area": "Baner", "city": "Pune",
                                                  "website": "https://mydental.in"}).json()["id"]
    first = client.get(f"/api/v1/businesses/{bid}/competitor-research").json()
    assert first["run"] is None and first["setup"]["google_results"] is True
    assert first["defaults"]["keywords"][0] == "dentist in Baner"

    r = client.post(f"/api/v1/businesses/{bid}/competitor-research", json={"keywords": KEYWORDS, "location": "Pune, India"})
    assert r.status_code == 202
    run = client.get(f"/api/v1/competitor-research/{r.json()['id']}").json()
    assert run["status"] == "done", run.get("error")
    assert run["result"]["summary"]["leader"]["domain"] == "smilecare.in"
    assert client.get(f"/api/v1/businesses/{bid}/competitor-research").json()["run"]["id"] == run["id"]
    # The run is not a business audit: it never changes the business's scores.
    assert run["business_id"] is None


def test_api_explains_a_missing_key(client):
    bid = client.post("/api/v1/businesses", json={"name": "No Key Clinic"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/competitor-research").json()["setup"]["google_results"] is False
    r = client.post(f"/api/v1/businesses/{bid}/competitor-research", json={"keywords": ["dentist in pune"]})
    assert r.status_code == 400 and "SERPER_API_KEY" in r.json()["detail"]
