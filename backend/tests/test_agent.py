

def test_the_activity_log_can_be_cut_to_one_month(client):
    bid = client.post("/api/v1/businesses", json={"name": "Month Co", "website": "https://month.example/"}).json()["id"]
    assert client.get(f"/api/v1/activity?business_id={bid}&since=2020-01-01&until=2020-02-01").json() == []
    assert client.get(f"/api/v1/activity?business_id={bid}&since=2020-01-01").status_code == 200
    assert client.get(f"/api/v1/activity?business_id={bid}&since=nonsense").status_code == 422
