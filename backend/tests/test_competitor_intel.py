"""Competitor research (app/competitors/intel.py): the Places API answers are faked, sites are fake pages."""
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


def fake_places(query, region="IN", lat=None, lng=None, radius_m=5000.0, page_size=20, language="en"):
    """Google Maps results, the way the Places API returns them."""
    if "baner" in query.lower():
        return [
            {"position": 1, "title": "Smile Care Dental", "rating": 4.8, "ratingCount": 900, "website": "https://smilecare.in/", "address": "12, FC Road, Baner, Pune, Maharashtra 411045", "cid": "1"},
            {"position": 2, "title": "Tooth Fairy", "rating": 4.0, "ratingCount": 60, "website": "https://toothfairy.com/", "address": "9, Road, Baner, Pune, Maharashtra 411045", "cid": "3"},
        ]
    return [
        {"position": 1, "title": "Smile Care Dental", "rating": 4.8, "ratingCount": 900, "website": "https://smilecare.in/", "address": "12, FC Road, Baner, Pune, Maharashtra 411045", "cid": "1"},
        {"position": 2, "title": "My Dental", "rating": 4.2, "ratingCount": 40, "website": "https://mydental.in/", "address": "4, Main St, Baner, Pune, Maharashtra 411045", "cid": "2"},
    ]


@pytest.fixture
def faked(monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-key")
    get_settings.cache_clear()
    from app.competitors import service
    monkeypatch.setattr(service, "places_search", fake_places)
    monkeypatch.setattr(intel, "scan_site", lambda url, **kw: {"url": url, "host": intel.host_of(url), "pages": SITES.get(intel.host_of(url), [])})
    yield
    get_settings.cache_clear()


ME = SimpleNamespace(id=1, name="My Dental", website="https://mydental.in", phone="", area="Baner", city="Pune", primary_category="Dentist", secondary_categories=[], services=[], rating=4.2, review_count=40)


def test_default_keywords_name_the_place():
    b = SimpleNamespace(name="X", primary_category="Dentist", secondary_categories=[], services=[{"name": "Teeth whitening"}], area="Baner, Pune", city="Pune")
    kws = intel.default_keywords(b)
    assert kws[:3] == ["dentist in Baner", "dentist in Pune", "best dentist in Pune"]
    assert "teeth whitening in Baner" in kws and len(kws) <= 6


def test_research_needs_the_places_key(monkeypatch):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "")
    monkeypatch.setenv("GOOGLE_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(intel.IntelError, match="GOOGLE_PLACES_API_KEY"):
        intel.analyse(ME, KEYWORDS, "Pune, India")
    get_settings.cache_clear()


def test_analysis_maps_competitors_gaps_and_strategy(faked):
    r = intel.analyse(ME, KEYWORDS, "Pune, India", own_positions={"dentist in Pune": {"position": 3.6}})

    # Your own positions: organic from Search Console (rounded), Maps from Google Places (#2 for the Pune search, absent for Baner).
    assert r["you"]["positions"] == {"dentist in Pune": 4}
    assert r["you"]["local"] == {"dentist in Pune": 2}
    assert r["summary"]["keywords_ranked"] == 1 and r["summary"]["keywords_total"] == 2
    assert r["sources"]["google"] == "google_places" and r["sources"]["organic"] == "search_console" and r["sources"]["credits"] == 0

    # Rivals are the Maps businesses; Google gives no other site's organic rankings, so there is no organic competitor list.
    assert r["organic_competitors"] == [] and r["local_competitors"][0]["name"] == "Smile Care Dental"
    domains = {p["domain"] for p in r["profiles"]}
    assert {"smilecare.in", "toothfairy.com"} <= domains and "mydental.in" not in domains

    # What the leader does on its site (a scan of its own website).
    smile = next(p for p in r["profiles"] if p["domain"] == "smilecare.in")
    site = smile["site"]
    assert "Dental Implants" in site["services"] and "Braces" in site["services"]
    assert "Contact Us" not in site["services"] and "View More" not in site["services"] and "Mumbai" not in site["services"]
    assert site["blog"] is True and "Dentist" in site["schema"] and smile["link_sources"] == []
    assert any("Separate pages for its services" in line for line in smile["strategy"])
    assert not any("hyderabad" in k for k in r["ideas"]["competitor_keywords"])  # another city's phrases are not ideas for this business

    # Gap: for "dentist in Baner" the business is not in the Maps results while rivals are.
    assert [g["keyword"] for g in r["gaps"]["keywords"]] == ["dentist in Baner"] and r["gaps"]["listings"] == []
    titles = [a["title"] for a in r["actions"]]
    assert 'Build or improve a page for "dentist in Baner"' in titles and "Close the review gap" in titles
    assert "Add LocalBusiness structured data" in titles  # Smile Care uses Dentist schema, My Dental none


def test_api_runs_in_the_background(client, faked):
    bid = client.post("/api/v1/businesses", json={"name": "My Dental", "primary_category": "Dentist", "area": "Baner", "city": "Pune", "website": "https://mydental.in"}).json()["id"]
    first = client.get(f"/api/v1/businesses/{bid}/competitor-research").json()
    assert first["run"] is None and first["setup"]["google_results"] is True
    assert first["defaults"]["keywords"][0] == "dentist in Baner"

    r = client.post(f"/api/v1/businesses/{bid}/competitor-research", json={"keywords": KEYWORDS, "location": "Pune, India"})
    assert r.status_code == 202
    run = client.get(f"/api/v1/competitor-research/{r.json()['id']}").json()
    assert run["status"] == "done", run.get("error")
    assert run["result"]["local_competitors"][0]["name"] == "Smile Care Dental"
    assert client.get(f"/api/v1/businesses/{bid}/competitor-research").json()["run"]["id"] == run["id"]
    assert run["business_id"] is None  # the run is not a business audit: it never changes the business's scores


def test_api_explains_a_missing_key(client):
    bid = client.post("/api/v1/businesses", json={"name": "No Key Clinic"}).json()["id"]
    assert client.get(f"/api/v1/businesses/{bid}/competitor-research").json()["setup"]["google_results"] is False
    r = client.post(f"/api/v1/businesses/{bid}/competitor-research", json={"keywords": ["dentist in pune"]})
    assert r.status_code == 400 and "GOOGLE_PLACES_API_KEY" in r.json()["detail"]


def test_progress_streams_what_is_found_so_far(faked):
    events = []
    r = intel.analyse(ME, KEYWORDS, "Pune, India", events.append)
    found = [e["found"] for e in events if "found" in e]
    assert found, "the page shows what was found while the research is still running"
    assert found[0]["keywords"] and found[0]["maps"]
    assert len(found[-1]["keywords"]) >= len(found[0]["keywords"])
    assert any(e["step"].startswith("Scanned ") for e in events)  # sites arrive one by one
    assert r["local_competitors"]


def test_a_run_whose_worker_died_is_failed_not_left_spinning(client_with_db=None):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    from app.competitors import intel_router

    class DB:
        committed = False

        def commit(self):
            self.committed = True

    old = SimpleNamespace(status="running", updated_at=datetime.now(timezone.utc) - timedelta(minutes=10), created_at=None, error=None, finished_at=None)
    fresh = SimpleNamespace(status="running", updated_at=datetime.now(timezone.utc) - timedelta(seconds=20), created_at=None, error=None, finished_at=None)
    db = DB()
    assert intel_router._expire_stale(db, old).status == "failed" and "interrupted" in old.error and db.committed
    assert intel_router._expire_stale(DB(), fresh).status == "running"


def test_one_competitor_list_feeds_the_watch_and_the_link_gap(client):
    """A competitor saved on the Competitors page (not a Backlink Intelligence target) is also watched and used for the link gap."""
    from app.backlinks import watch
    from app.competitors import hygiene
    from app.db import SessionLocal
    from app.models import Business, Competitor
    bid = client.post("/api/v1/businesses", json={"name": "Shared Co", "website": "https://shared-co.example"}).json()["id"]
    db = SessionLocal()
    db.add_all([Competitor(business_id=bid, name="Rival", website="https://www.rival-one.example/", source="manual"),
                Competitor(business_id=bid, name="Insta", website="https://instagram.com/x", source="manual")])
    db.commit()
    b = db.get(Business, bid)
    assert hygiene.saved_competitor_domains(db, b) == ["rival-one.example"]  # a social page is never a competitor
    assert watch.competitor_domains(db, bid) == ["rival-one.example"]
    db.close()


def test_a_competitor_added_in_the_google_profile_section_is_in_the_shared_list(client):
    from app.competitors import hygiene
    from app.db import SessionLocal
    from app.models import Business
    bid = client.post("/api/v1/businesses", json={"name": "Share Two", "website": "https://share-two.example", "city": "Pune"}).json()["id"]
    r = client.post(f"/api/v1/businesses/{bid}/gbp/competitors", json={"name": "Rival Two", "website": "https://www.rival-two.example"})
    assert r.status_code == 201, r.text
    db = SessionLocal()
    assert hygiene.saved_competitor_domains(db, db.get(Business, bid)) == ["rival-two.example"]
    db.close()
