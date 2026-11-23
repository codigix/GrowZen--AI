def test_the_portfolio_lists_every_project_with_its_numbers(client):
    a = client.post("/api/v1/businesses", json={"name": "Alpha Co", "website": "https://alpha.example/"}).json()["id"]
    b = client.post("/api/v1/businesses", json={"name": "Beta Co", "website": "https://beta.example/"}).json()["id"]
    d = client.get("/api/v1/gbp/portfolio").json()
    ids = [p["id"] for p in d["projects"]]
    assert a in ids and b in ids and d["totals"]["projects"] >= 2
    r = next(p for p in d["projects"] if p["id"] == a)
    assert r["google"]["linked"] is False and "Not connected to Google" in r["attention"]
    assert len(r["insights"]["actions"]) == 30 and set(r["posts"]) >= {"published_30d", "scheduled", "drafts"}
    assert d["totals"]["connected"] == sum(1 for p in d["projects"] if p["google"]["linked"])
