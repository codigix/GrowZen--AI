"""Onboarding follow-ups: fixes for the website / Google profile found while onboarding become to-do tasks."""


def test_follow_ups_become_tasks_once(client):
    bid = client.post("/api/v1/businesses", json={"name": "Sai Dental", "phone": "+91 98220 11223", "address": "12 FC Road, Pune 411004",
                                                  "website": "https://saidental.in", "primary_category": "Dentist"}).json()["id"]
    body = [
        {"kind": "website_fix", "title": "Show the phone number on the website", "fix": "Put it in the footer.", "code": "nap_phone", "impact": "High"},
        {"kind": "website_fix", "title": "Add LocalBusiness structured data", "code": "no_localbusiness_schema"},
        {"kind": "profile_edit", "title": "Add the website to the Google profile", "fix": "Google listing has no website."},
    ]
    r = client.post(f"/api/v1/businesses/{bid}/tasks", json=body)
    assert r.status_code == 201 and r.json()["added"] == 3

    tasks = {t["title"]: t for t in client.get(f"/api/v1/tasks?business_id={bid}").json()}
    phone = tasks["Show the phone number on the website"]
    assert phone["kind"] == "website_fix" and phone["impact"] == "High" and phone["detail"]["source"] == "onboarding"
    assert "+91 98220 11223" in phone["detail"]["draft"]["changes"][0]["after"]  # ready-to-paste contact block
    assert '"@type": "LocalBusiness"' in tasks["Add LocalBusiness structured data"]["detail"]["draft"]["changes"][0]["after"]
    assert tasks["Add the website to the Google profile"]["detail"]["risk"] == "high"  # what the public sees always asks first

    # Launching again does not add the same fixes twice.
    assert client.post(f"/api/v1/businesses/{bid}/tasks", json=body).json()["added"] == 0


def test_follow_ups_need_login():
    from fastapi.testclient import TestClient
    from app.main import app
    assert TestClient(app).post("/api/v1/businesses/1/tasks", json=[]).status_code == 401


def test_fresh_refetch_skips_the_places_cache(monkeypatch):
    from app.services import discovery
    calls = []

    class Resp:
        status_code = 200
        def json(self):
            return {"id": "p1", "nationalPhoneNumber": f"0{len(calls)}"}

    monkeypatch.setattr(discovery, "places_key", lambda: "k")
    monkeypatch.setattr(discovery.httpx, "get", lambda *a, **kw: calls.append(1) or Resp())
    discovery._details_cache.clear()
    first = discovery.place_details("p1")
    assert discovery.place_details("p1") is first and len(calls) == 1  # cached
    assert discovery.place_details("p1", fresh=True)["nationalPhoneNumber"] == "02" and len(calls) == 2  # fetched again
    assert discovery.place_details("p1")["nationalPhoneNumber"] == "02"  # and the cache now holds the new answer
    discovery._details_cache.clear()
