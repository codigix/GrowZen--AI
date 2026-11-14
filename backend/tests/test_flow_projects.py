"""Each project's own journey position, for the dashboard's project cards."""


def test_each_project_reports_its_own_step(client):
    a = client.post("/api/v1/businesses", json={"name": "Alpha Flow Co"}).json()["id"]
    b = client.post("/api/v1/businesses", json={"name": "Beta Flow Co", "website": "https://betaflow.example/", "phone": "+91 9000000000", "city": "Pune"}).json()["id"]
    r = client.get("/api/v1/flow/projects").json()["projects"]
    assert str(a) in r and str(b) in r
    for v in r.values():
        assert v["total"] == 10 and 0 <= v["done"] <= 10 and v["percent"] == round(v["done"] / 10 * 100)
        assert v["next"] is None or (v["next"]["order"] and v["next"]["title"] and v["next"]["link"])
    one = client.get(f"/api/v1/businesses/{a}/flow").json()
    assert r[str(a)]["done"] == one["done"] and r[str(a)]["next"]["title"] == one["next"]["title"]
