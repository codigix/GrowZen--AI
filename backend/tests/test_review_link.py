"""Get more reviews: the share link, the public customer page and its AI wording (AI stubbed)."""
from app.db import SessionLocal
from app.models import Business
from app.routers import review_link
from app.services import ai


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Review Co", "primary_category": "Clothes rental", "city": "Pune", "services": [{"name": "Lehenga rental"}, {"name": "Sherwani rental"}], **extra})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_link_is_signed_and_public_page_shows_only_safe_fields(client):
    bid = _project(client, phone="9999999999")
    with SessionLocal() as db:  # the place id arrives from the Google sync, not from the create form
        db.get(Business, bid).place_id = "ChIJabc"
        db.commit()
    link = client.get(f"/api/v1/businesses/{bid}/review-link").json()
    assert link["share_url"].endswith("/r/" + link["token"]) and link["token"].startswith(f"{bid}-")
    assert link["google_url"] == "https://search.google.com/local/writereview?placeid=ChIJabc"
    pub = client.get(f"/api/v1/public/review/{link['token']}")
    assert pub.status_code == 200
    data = pub.json()
    assert data["name"] == "Review Co" and data["services"] == ["Lehenga rental", "Sherwani rental"]
    assert "phone" not in data and "9999999999" not in pub.text  # nothing private leaves
    # A guessed or altered token is refused
    assert client.get(f"/api/v1/public/review/{bid}-000000000000").status_code == 404
    assert client.get("/api/v1/public/review/nonsense").status_code == 404


def test_suggestion_uses_only_what_the_customer_picked(client, monkeypatch):
    bid = _project(client)
    token = review_link.token_for(bid)
    seen = {}
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    def fake(system, user, **kw):
        seen["user"] = user
        return {"text": "Lovely lehenga, easy and quick."}
    monkeypatch.setattr(ai, "complete_json", fake)
    review_link._hits.clear()
    r = client.post(f"/api/v1/public/review/{token}/suggest", json={"rating": 5, "services": ["Lehenga rental", "Not a service"], "notes": "friendly staff", "language": "English"})
    assert r.status_code == 200 and r.json()["text"].startswith("Lovely")
    assert "Lehenga rental" in seen["user"] and "Not a service" not in seen["user"] and "friendly staff" in seen["user"]
    assert client.post(f"/api/v1/public/review/{token}/suggest", json={"rating": 9}).status_code == 422  # stars must be 1 to 5


def test_suggestions_are_rate_limited_and_need_ai(client, monkeypatch):
    bid = _project(client)
    token = review_link.token_for(bid)
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    assert client.post(f"/api/v1/public/review/{token}/suggest", json={"rating": 5}).status_code == 503
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda *a, **k: {"text": "Good."})
    review_link._hits.clear()
    codes = [client.post(f"/api/v1/public/review/{token}/suggest", json={"rating": 4}).status_code for _ in range(review_link.LIMIT + 2)]
    assert codes[: review_link.LIMIT] == [200] * review_link.LIMIT and codes[-1] == 429


def test_profile_share_link_prefers_googles_own_and_falls_back_to_a_maps_search(client):
    bid = _project(client, address="12 MG Road, Pune")
    link = client.get(f"/api/v1/businesses/{bid}/review-link").json()
    assert link["profile_url"].startswith("https://www.google.com/maps/search/?api=1&query=Review+Co") and "query_place_id" not in link["profile_url"]
    with SessionLocal() as db:
        b = db.get(Business, bid)
        b.place_id = "ChIJabc"
        db.commit()
    assert "query_place_id=ChIJabc" in client.get(f"/api/v1/businesses/{bid}/review-link").json()["profile_url"]
    with SessionLocal() as db:
        b = db.get(Business, bid)
        b.gbp_status = {"maps_url": "https://maps.google.com/maps?cid=123"}
        db.commit()
    assert client.get(f"/api/v1/businesses/{bid}/review-link").json()["profile_url"] == "https://maps.google.com/maps?cid=123"
