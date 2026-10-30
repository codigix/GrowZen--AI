"""SEO toolkit endpoints: domain overview, top pages, organic rank checks and the keyword overview."""
import pytest
from test_competitor_intel import faked, fake_call  # noqa: F401  (the Serper fake)

from app.competitors import intel

CASED = {"dentist in pune": "dentist in Pune", "dentist in baner": "dentist in Baner"}


@pytest.fixture
def serper(faked, monkeypatch):  # noqa: F811
    """The fake answers by exact text; keywords are saved lowercase, so match them the way Google does (ignoring case)."""
    monkeypatch.setattr(intel.Serper, "call", lambda self, path, body: fake_call(self, path, body | {"q": CASED.get(body["q"].lower(), body["q"])}))


def business(client):
    return client.post("/api/v1/businesses", json={"name": "My Dental", "primary_category": "Dentist", "area": "Baner", "city": "Pune", "website": "https://mydental.in"}).json()["id"]


def test_domain_page_works_before_anything_has_run(client):
    bid = business(client)
    o = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()
    assert o["domain"] == "mydental.in" and o["rankings"]["tracked"] == 0 and o["traffic"]["state"] in ("not_connected", "scope_missing", "no_website")
    assert client.get(f"/api/v1/businesses/{bid}/seo/top-pages").json() == {"pages": [], "audited_at": None}


def test_check_ranks_saves_positions_and_the_change(client, serper):
    bid = business(client)
    client.post(f"/api/v1/businesses/{bid}/keywords", json=[{"keyword": "dentist in Pune"}, {"keyword": "dentist in Baner"}])
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={}).json()
    by = {x["keyword"]: x for x in r["results"]}
    assert by["dentist in pune"]["rank"] == 4 and by["dentist in pune"]["url"] == "https://mydental.in/"  # mydental.in is #4 in the fake results
    assert by["dentist in baner"]["rank"] is None  # not in Google's results for that search
    kws = {k["keyword"]: k for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}
    assert kws["dentist in pune"]["rank"] == 4 and kws["dentist in pune"]["rank_checked_at"]
    # A second check keeps the previous position so the page can show the move.
    client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={"keywords": ["dentist in pune"]})
    k = {k["keyword"]: k for k in client.get(f"/api/v1/businesses/{bid}/keywords").json()["keywords"]}["dentist in pune"]
    assert k["prev_rank"] == 4
    o = client.get(f"/api/v1/businesses/{bid}/seo/domain").json()["rankings"]
    assert o["tracked"] == 2 and o["ranking"] == 1
    # Each check is a history row, so the trend is real: the same day updates its row instead of duplicating it.
    h = client.get(f"/api/v1/businesses/{bid}/seo/rank-history").json()["history"]
    assert [x["rank"] for x in h["dentist in pune"]] == [4] and [x["rank"] for x in h["dentist in baner"]] == [None]


def test_keyword_overview_reads_google_from_the_business_place(client, serper):
    bid = business(client)
    o = client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "Dentist in Pune"}).json()
    assert o["keyword"] == "dentist in pune" and o["intent"] == "local"
    assert o["you"]["organic"] == 4 and o["you"]["local"] == 2  # mydental.in is #4 on Google and #2 in Maps in the fake results
    assert [x["position"] for x in o["organic"]][:2] == [1, 4] and any(x["mine"] for x in o["organic"])
    assert o["metrics"]["volume"] is None  # no volume without a provider: never invented


def test_rank_checks_explain_a_missing_key_or_website(client, monkeypatch):
    bid = business(client)
    r = client.post(f"/api/v1/businesses/{bid}/seo/check-ranks", json={})
    assert r.status_code == 400 and "SERPER_API_KEY" in r.json()["detail"]
    assert client.post(f"/api/v1/businesses/{bid}/seo/keyword-overview", json={"keyword": "dentist"}).status_code == 400
