"""GBP Local SEO: one score and a to-do list from the profile, reviews, listings, website and tracked searches."""
from app.routers import gbp_local_seo as g


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental service", "city": "Pune", "phone": "+91 98765 43210", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_review_score_rewards_count_and_rating():
    assert g._reviews_score(None, 0) == 0
    assert g._reviews_score(5.0, 1) == 33
    assert g._reviews_score(4.6, 25) == 100
    assert g._reviews_score(4.1, 25) == 90 and g._reviews_score(3.5, 25) == 80


def test_local_seo_overview_and_the_next_steps(client):
    bid = _project(client)
    d = client.get(f"/api/v1/businesses/{bid}/gbp/local-seo").json()
    assert set(d["parts"]) == {"profile", "reviews", "citations", "website", "rankings"}
    assert d["parts"]["website"]["score"] == 0  # no website on the profile
    assert d["parts"]["rankings"]["score"] is None and d["parts"]["citations"]["score"] is not None
    assert d["score"] is not None and 0 <= d["score"] <= 100
    keys = [a["key"] for a in d["actions"]]
    assert "no-website" in keys and "reviews" in keys and "seed" in keys  # nothing tracked yet: start tracking
    assert next(a for a in d["actions"] if a["key"] == "seed")["action"] == "seed"
    assert d["suggestions"] and all("pune" in k.lower() for k in d["suggestions"])
    # Once searches are tracked the 'start tracking' step goes and 'check now' takes its place
    assert client.post(f"/api/v1/businesses/{bid}/seo/seed-keywords").json()["added"] >= 1
    d2 = client.get(f"/api/v1/businesses/{bid}/gbp/local-seo").json()
    keys2 = [a["key"] for a in d2["actions"]]
    assert "seed" not in keys2 and "check" in keys2 and d2["positions"]["summary"]["keywords"] >= 1


def test_local_seo_is_private(client):
    from test_security import login, user
    user("ls1@x.in", "editor")
    user("ls2@x.in", "editor")
    a, _ = login("ls1@x.in")
    o, _ = login("ls2@x.in")
    bid = a.post("/api/v1/businesses", json={"name": "Mine Co"}).json()["id"]
    assert a.get(f"/api/v1/businesses/{bid}/gbp/local-seo").status_code == 200
    assert o.get(f"/api/v1/businesses/{bid}/gbp/local-seo").status_code == 404
