from datetime import date


def _biz(client):
    return client.post("/api/v1/businesses", json={"name": "Report Co", "website": "https://report.example/"}).json()["id"]


def test_the_report_link_can_be_made_read_without_sign_in_renewed_and_switched_off(client):
    bid = _biz(client)
    p = f"/api/v1/businesses/{bid}/gbp/reports/share"
    assert client.get(p).json()["enabled"] is False
    made = client.post(p).json()
    assert made["enabled"] and "/report/" in made["url"]
    token = made["url"].rsplit("/report/", 1)[1]
    assert "report_key" not in client.get(f"/api/v1/businesses/{bid}").json()  # the secret is never part of the project's data
    pub = client.get(f"/api/v1/public/client-report/{token}")
    assert pub.status_code == 200
    d = pub.json()
    assert d["business"]["name"] == "Report Co" and len(d["months"]) == 12 and d["months"][-1]["month"] == date.today().strftime("%Y-%m")
    assert "email" not in str(d["business"]).lower()
    assert client.get(f"/api/v1/public/client-report/{token}x").status_code == 404
    again = client.post(p).json()["url"].rsplit("/report/", 1)[1]
    assert again != token and client.get(f"/api/v1/public/client-report/{token}").status_code == 404 and client.get(f"/api/v1/public/client-report/{again}").status_code == 200
    assert client.delete(p).json()["enabled"] is False
    assert client.get(f"/api/v1/public/client-report/{again}").status_code == 404
    assert client.get(f"/api/v1/public/client-report/{again}?month=2999-01").status_code in (404, 422)
