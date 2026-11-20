def test_a_new_project_shows_what_is_not_connected(client):
    bid = client.post("/api/v1/businesses", json={"name": "Conn Co", "website": "https://conn.example/"}).json()["id"]
    r = client.get(f"/api/v1/businesses/{bid}/connections").json()
    by = {x["key"]: x for x in r["connections"]}
    assert r["connected"] == 0 and r["total"] == 5
    assert set(by) == {"google", "gbp", "search_console", "analytics", "website"}
    assert all(not x["connected"] and x["detail"] for x in by.values())
