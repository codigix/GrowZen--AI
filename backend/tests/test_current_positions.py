"""Where the project stands on Google: Search Console's average position and page, the Maps position from the Places API, the targeted area. Google is faked: no calls are made."""
import pytest
from test_competitor_intel import faked  # noqa: F401  (sets GOOGLE_PLACES_API_KEY and clears the cache)
from test_security import login, user

from app.competitors import service
from app.db import SessionLocal
from app.models import Business, GoogleConnection
from app.services import gsc_access, organic

PLACES = [
    {"position": 1, "title": "Smile Care Dental", "website": "https://smilecare.in/", "phoneNumber": "+91 98765 00001", "cid": "1"},
    {"position": 2, "title": "My Dental Clinic", "website": "https://mydental.in/", "phoneNumber": "+91 98220 10099", "cid": "2"},
    {"position": 3, "title": "Tooth Fairy", "website": "https://toothfairy.com/", "cid": "3"},
]
ROWS = {  # Search Console rows: (query, page) -> clicks, impressions, average position
    "dental implants kesnand": [{"keys": ["dental implants kesnand", "https://mydental.in/services"], "clicks": 3, "impressions": 100, "position": 14.2}],
    "dentist kesnand": [{"keys": ["dentist kesnand", "https://mydental.in/"], "clicks": 40, "impressions": 400, "position": 1.3},
                        {"keys": ["dentist kesnand", "https://mydental.in/about"], "clicks": 1, "impressions": 100, "position": 6.0}],
}
CALLS: list[tuple[str, object]] = []


class FakeSearchConsole:
    def query(self, site, body):
        CALLS.append(("gsc", body))
        return [r for rows in ROWS.values() for r in rows]


@pytest.fixture
def google(faked, monkeypatch):  # noqa: F811
    CALLS.clear()
    monkeypatch.setattr(gsc_access, "search_console", lambda db, b, host: ("ok", "owner@x.in", FakeSearchConsole(), "sc-domain:mydental.in"))

    def places(query, region="IN", lat=None, lng=None, radius_m=5000.0, page_size=20, language="en"):
        CALLS.append(("places", query))
        return [] if "nowhere" in query else PLACES

    monkeypatch.setattr(service, "places_search", places)


def business(client, **extra):
    return client.post("/api/v1/businesses", json={"name": "My Dental Clinic", "primary_category": "Dentist", "area": "Kesnand", "city": "Pune", "website": "https://mydental.in", "phone": "+91 98220 10099", **extra}).json()["id"]


def link_google(bid):
    """A linked Google account with the Search Console permission, so the project can read positions."""
    db = SessionLocal()
    c = GoogleConnection(email="owner@x.in", status="active", scopes="https://www.googleapis.com/auth/webmasters.readonly", refresh_token_enc="x", connected_by="user 1")
    db.add(c)
    db.flush()
    db.get(Business, bid).connection_id = c.id
    db.commit()
    db.close()


def test_page_and_position_math():
    assert [organic.page_of(p) for p in (1, 10, 11, 20, 21, 100)] == [1, 1, 2, 2, 3, 10]
    assert [organic.position_on_page(p) for p in (1, 10, 11, 14, 100)] == [1, 10, 1, 4, 10]
    assert organic.page_of(None) is None and organic.position_on_page(None) is None and organic.page_of(0) is None


def test_the_business_is_found_in_maps_by_id_phone_site_then_name():
    b = Business(name="My Dental Clinic", website="https://www.mydental.in/", phone="098220 10099", place_id="ChIJabc")
    rows = [{"position": 1, "title": "Other", "website": "https://o.com"}, {"position": 2, "title": "X", "placeId": "ChIJabc"}]
    assert organic.find_listing(rows, b)[0] == 2  # by Google place id
    rows = [{"position": 4, "title": "Y", "phoneNumber": "+91 98220 10099"}]
    assert organic.find_listing(rows, Business(name="Z", phone="09822010099"))[0] == 4  # same number, written differently
    rows = [{"position": 3, "title": "Y", "website": "http://mydental.in/contact"}]
    assert organic.find_listing(rows, Business(name="Z", website="https://www.mydental.in"))[0] == 3  # by website host
    rows = [{"title": "my  DENTAL clinic!"}]
    assert organic.find_listing(rows, Business(name="My Dental Clinic"))[0] == 1  # by name, ignoring case and punctuation; position = order when missing
    assert organic.find_listing([{"position": 1, "title": "Smile Care"}], Business(name="My Dental Clinic")) == (None, None)


def test_current_positions_show_search_console_positions_and_the_maps_rank(client, google):
    bid = business(client)
    link_google(bid)
    client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["google"], "device": "mobile", "location": "Kesnand, Pune, India", "language": "en",
                                                                    "keywords": ["dental implants kesnand", "dentist nowhere", "dentist kesnand"]})
    before = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert before["state"] == "no_data" and before["rank_ready"] is True and all(not r["checked"] for r in before["rows"])  # never invent a position

    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={}).json()
    assert r["checked"] == 3 and r["days"] == 28 and r["maps"] is True and "Search Console" in r["source"]
    assert [c for c, _ in CALLS].count("gsc") == 1  # ONE Search Console request for all keywords
    assert sorted(q for c, q in CALLS if c == "places") == ["dental implants kesnand", "dentist kesnand", "dentist nowhere"]  # one Maps request per keyword

    cur = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert cur["state"] == "ok" and cur["area"]["label"] == "Kesnand, Pune, India · mobile · English"
    by = {x["keyword"]: x for x in cur["rows"]}
    imp = by["dental implants kesnand"]["organic"]
    assert (imp["found"], imp["position"], imp["page"], imp["position_on_page"], imp["average_position"], imp["impressions"], imp["clicks"]) == (True, 14, 2, 4, 14.2, 100, 3)
    assert imp["label"] == "Average position 14.2" and imp["url"] == "https://mydental.in/services" and imp["source"] == "search_console"
    assert by["dental implants kesnand"]["maps"] | {"x": 0} == {"checked": True, "found": True, "position": 2, "in_pack": True, "listing": "My Dental Clinic", "total": 3, "label": "#2 in Maps", "x": 0}
    assert by["dental implants kesnand"]["who_is_first"] == {"domain": None, "maps": "Smile Care Dental"}   # Google gives no other site's organic rank: only the Maps leader
    two = by["dentist kesnand"]["organic"]
    assert two["average_position"] == 2.2 and two["position"] == 2 and two["page"] == 1   # weighted by impressions across the two pages that rank
    nf = by["dentist nowhere"]
    assert nf["organic"]["found"] is False and nf["organic"]["label"] == "No impressions on Google yet (last 28 days)"
    assert nf["maps"]["found"] is False and nf["maps"]["label"] == "Not in Maps results" and nf["maps"]["in_pack"] is False
    s = cur["summary"]
    assert (s["page1"], s["page2"], s["not_found"], s["in_pack"]) == (1, 1, 1, 2) and cur["last_checked_at"]

    # a second check keeps the previous position so the move shows
    CALLS.clear()
    client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={"keywords": ["dental implants kesnand"]})
    again = {x["keyword"]: x for x in client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()["rows"]}["dental implants kesnand"]["organic"]
    assert again["position"] == 14 and again["change_vs_previous"] == 0 and again["previous_position"] == 14


def test_a_project_without_search_console_access_says_so(client):
    bid = business(client)
    cur = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert cur["state"] == "needs_google" and cur["rank_ready"] is False
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={})
    assert r.status_code == 400 and "Google account" in r.json()["detail"]


def test_another_users_project_positions_are_not_visible(client):
    user("owner-pos@x.in", "editor")
    user("other-pos@x.in", "editor")
    a, _ = login("owner-pos@x.in")
    b, _ = login("other-pos@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Private Dental", "website": "https://private.example"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/seo/current-positions").status_code == 200
    assert b.get(f"/api/v1/businesses/{bid}/seo/current-positions").status_code == 404


def test_device_positions_split_search_console_by_desktop_mobile_tablet(client, google, monkeypatch):
    from app.services import google_rank
    bid = business(client)
    link_google(bid)
    client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["google"], "device": "desktop", "location": "Pune, India", "language": "en", "keywords": ["dentist kesnand", "dental implants kesnand"]})
    rows = [{"keys": ["dentist kesnand", "DESKTOP"], "clicks": 30, "impressions": 300, "position": 2.0}, {"keys": ["dentist kesnand", "MOBILE"], "clicks": 10, "impressions": 100, "position": 4.0},
            {"keys": ["dentist kesnand", "TABLET"], "clicks": 0, "impressions": 0, "position": 9.0},          # no impressions: not counted
            {"keys": ["dental implants kesnand", "MOBILE"], "clicks": 2, "impressions": 100, "position": 12.0}, {"keys": ["something else", "MOBILE"], "clicks": 9, "impressions": 900, "position": 1.0}]
    monkeypatch.setattr(FakeSearchConsole, "query", lambda self, site, body: rows)
    google_rank._device_cache.clear()
    d = client.get(f"/api/v1/businesses/{bid}/seo/device-positions").json()
    assert d["state"] == "ok" and d["days"] == 28
    assert d["devices"]["desktop"] == {"keywords": 1, "impressions": 300, "clicks": 30, "ctr": 10.0, "position": 2.0}
    assert d["devices"]["mobile"]["keywords"] == 2 and d["devices"]["mobile"]["impressions"] == 200 and d["devices"]["mobile"]["position"] == 8.0   # (4*100 + 12*100) / 200; a keyword that is not tracked is left out
    assert d["devices"]["tablet"]["keywords"] == 0 and d["devices"]["tablet"]["position"] is None
    assert d["keywords"]["dentist kesnand"] == {"desktop": {"position": 2.0, "impressions": 300, "clicks": 30}, "mobile": {"position": 4.0, "impressions": 100, "clicks": 10}}
    noacct = business(client)
    client.post(f"/api/v1/businesses/{noacct}/keywords", json=[{"keyword": "dentist kesnand"}])
    assert client.get(f"/api/v1/businesses/{noacct}/seo/device-positions").json()["state"] == "needs_google"
