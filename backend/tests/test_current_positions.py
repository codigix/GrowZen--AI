"""Where the project stands on Google right now: results page + position, Maps position, the targeted area. Serper is mocked: no credits spent."""
import pytest
from test_competitor_intel import faked  # noqa: F401  (sets SERPER_API_KEY and clears the cache)
from test_security import login, user

from app.competitors import intel
from app.models import Business
from app.services import organic

CALLS: list[tuple[str, dict]] = []


def organic_results(site_at: int | None, total: int = 100):
    """total results; our site (mydental.in) at the given position, or not at all."""
    out = []
    for i in range(1, total + 1):
        out.append({"position": i, "link": f"https://mydental.in/services" if i == site_at else f"https://other{i}.example/", "title": f"Result {i}"})
    return {"organic": out}


PLACES = {"places": [
    {"position": 1, "title": "Smile Care Dental", "website": "https://smilecare.in/", "phoneNumber": "+91 98765 00001", "cid": "1"},
    {"position": 2, "title": "My Dental Clinic", "website": "https://mydental.in/", "phoneNumber": "+91 98220 10099", "cid": "2"},
    {"position": 3, "title": "Tooth Fairy", "website": "https://toothfairy.com/", "cid": "3"},
]}


@pytest.fixture
def serper(faked, monkeypatch):  # noqa: F811
    CALLS.clear()

    def call(self, path, body):
        CALLS.append((path, dict(body)))
        if path == "/places":
            return {"places": [] if "nowhere" in body["q"] else PLACES["places"], "credits": 1}
        q = body["q"].lower()
        if "implants" in q:
            return organic_results(14) | {"credits": 2}  # page 2, 4th on the page
        if "nowhere" in q:
            return organic_results(None) | {"credits": 2}
        return organic_results(1) | {"credits": 2}

    monkeypatch.setattr(intel.Serper, "call", call)


def business(client, **extra):
    return client.post("/api/v1/businesses", json={"name": "My Dental Clinic", "primary_category": "Dentist", "area": "Kesnand", "city": "Pune", "website": "https://mydental.in", "phone": "+91 98220 10099", **extra}).json()["id"]


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


def test_current_positions_show_page_position_maps_and_the_targeted_area(client, serper):
    bid = business(client)
    client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["google"], "device": "mobile", "location": "Kesnand, Pune, India", "language": "en",
                                                                    "keywords": ["dental implants kesnand", "dentist nowhere", "dentist kesnand"]})
    before = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert before["state"] == "no_data" and all(not r["checked"] for r in before["rows"])  # never invent a position

    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={}).json()
    assert r["depth"] == 100 and r["checked"] == 3
    search = [b for path, b in CALLS if path == "/search"]
    assert search and all(b["num"] == 100 and b["location"] == "Kesnand, Pune, India" and b["gl"] == "in" for b in search)  # deep, from the targeted area

    cur = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert cur["state"] == "ok" and cur["area"]["label"] == "Kesnand, Pune, India · mobile · English"
    by = {x["keyword"]: x for x in cur["rows"]}
    imp = by["dental implants kesnand"]["organic"]
    assert (imp["found"], imp["position"], imp["page"], imp["position_on_page"], imp["depth_checked"]) == (True, 14, 2, 4, 100)
    assert imp["label"] == "Page 2, position 4" and imp["url"] == "https://mydental.in/services"
    assert by["dental implants kesnand"]["maps"] | {"x": 0} == {"checked": True, "found": True, "position": 2, "in_pack": True, "listing": "My Dental Clinic", "total": 3, "label": "#2 in Maps", "x": 0}
    assert by["dental implants kesnand"]["who_is_first"] == {"domain": "other1.example", "maps": "Smile Care Dental"}
    nf = by["dentist nowhere"]
    assert nf["organic"]["found"] is False and nf["organic"]["page"] is None and nf["organic"]["label"] == "Not in the top 100"
    assert nf["maps"]["found"] is False and nf["maps"]["label"] == "Not in Maps results" and nf["maps"]["in_pack"] is False
    assert by["dentist kesnand"]["organic"]["page"] == 1
    s = cur["summary"]
    assert (s["page1"], s["page2"], s["page3plus"], s["not_found"], s["in_pack"]) == (1, 1, 0, 1, 2) and cur["last_checked_at"]

    # a second check shows the move (the site climbed from 14 to 1 for this keyword)
    client.put(f"/api/v1/businesses/{bid}/seo/track-campaign", json={"engines": ["google"], "device": "mobile", "location": "Kesnand, Pune, India", "keywords": []})
    CALLS.clear()
    client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={"keywords": ["dental implants kesnand"]})
    assert [p for p, _ in CALLS] == ["/search", "/places"]  # one deep request + one Maps request per keyword
    again = {x["keyword"]: x for x in client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()["rows"]}["dental implants kesnand"]["organic"]
    assert again["position"] == 14 and again["change_vs_previous"] == 0 and again["previous_position"] == 14


def test_a_project_with_no_google_key_says_so(client, monkeypatch):
    monkeypatch.setenv("SERPER_API_KEY", "")
    from app.config import get_settings
    get_settings.cache_clear()
    bid = business(client)
    cur = client.get(f"/api/v1/businesses/{bid}/seo/current-positions").json()
    assert cur["state"] == "needs_serper" and cur["serper"] is False
    get_settings.cache_clear()


def test_another_users_project_positions_are_not_visible(client):
    user("owner-pos@x.in", "editor")
    user("other-pos@x.in", "editor")
    a, _ = login("owner-pos@x.in")
    b, _ = login("other-pos@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Private Dental", "website": "https://private.example"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/seo/current-positions").status_code == 200
    assert b.get(f"/api/v1/businesses/{bid}/seo/current-positions").status_code == 404
