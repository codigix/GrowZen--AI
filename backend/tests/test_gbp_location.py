"""Profile status, 24-hour and extra hours, labels and the service area: written to Google first, read back on sync."""
import copy

import test_gbp as g
from app.config import get_settings
from app.db import SessionLocal
from app.models import Business
from app.services import gbp


def _import(client):
    cid = g.connection()
    return client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]


def _cleanup():
    db = SessionLocal()
    db.query(Business).filter(Business.gbp_location == "locations/1").delete()
    db.commit()
    db.close()


def _recorder(monkeypatch):
    sent = []
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if method in ("PATCH", "POST", "PUT", "DELETE") and "/revoke" not in url and "placeActionLinks" not in url:
            sent.append((method, url.split("/v1/")[-1], kw.get("params"), kw.get("json")))
            return {}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    return sent


def test_status_hours_labels_are_written_to_google_and_read_back(client, monkeypatch):
    g.fake_google(monkeypatch)
    original = copy.deepcopy(g.LOCATIONS[0])  # the shared fake listing is put back afterwards
    try:
        bid = _import(client)
        sent = _recorder(monkeypatch)
        day = {"openDay": "MONDAY", "closeDay": "MONDAY", "openTime": {"hours": 0, "minutes": 0}, "closeTime": {"hours": 24, "minutes": 0}}
        out = client.patch(f"/api/v1/businesses/{bid}", json={
            "open_status": "CLOSED_TEMPORARILY", "opening_date": "2024-05-31", "labels": ["Pune branch", "pune branch", "Rentals"],
            "hours": {"periods": [day]}, "more_hours": {"DELIVERY": [day], "KITCHEN": []}}).json()
        assert set(out["pushed_to_google"]) >= {"openInfo", "labels", "regularHours", "moreHours"}
        _, url, params, body = next(x for x in sent if x[1] == "locations/1")
        assert body["openInfo"] == {"status": "CLOSED_TEMPORARILY", "openingDate": {"year": 2024, "month": 5, "day": 31}}
        assert body["labels"] == ["Pune branch", "Rentals"]  # duplicates dropped
        assert body["regularHours"]["periods"][0]["closeTime"]["hours"] == 24  # open 24 hours
        assert body["moreHours"] == [{"hoursTypeId": "DELIVERY", "periods": [day]}]  # an empty type is not sent
        assert "openInfo" in params["updateMask"] and "moreHours" in params["updateMask"] and "labels" in params["updateMask"]
        # Only the status changes: the saved opening date is kept
        sent.clear()
        client.patch(f"/api/v1/businesses/{bid}", json={"open_status": "OPEN"})
        assert next(x for x in sent if x[1] == "locations/1")[3]["openInfo"] == {"status": "OPEN", "openingDate": {"year": 2024, "month": 5, "day": 31}}
        # Sync reads them back from Google
        g.LOCATIONS[0].update({"openInfo": {"status": "CLOSED_PERMANENTLY", "openingDate": {"year": 2020, "month": 1, "day": 2}}, "labels": ["From Google"],
                               "moreHours": [{"hoursTypeId": "PICKUP", "periods": [day]}]})
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        got = client.get(f"/api/v1/businesses/{bid}").json()
        assert got["open_status"] == "CLOSED_PERMANENTLY" and got["opening_date"] == "2020-01-02" and got["labels"] == ["From Google"] and list(got["more_hours"]) == ["PICKUP"]
    finally:
        g.LOCATIONS[0].clear()
        g.LOCATIONS[0].update(original)
        _cleanup()


def test_bad_values_are_refused(client, monkeypatch):
    g.fake_google(monkeypatch)
    try:
        bid = _import(client)
        sent = _recorder(monkeypatch)
        for bad in ({"open_status": "GONE"}, {"opening_date": "31/05/2024"}, {"opening_date": "2024-13-40"}, {"labels": [f"l{i}" for i in range(11)]}, {"more_hours": {"MOON": []}}):
            assert client.patch(f"/api/v1/businesses/{bid}", json=bad).status_code == 422, bad
        assert sent == []
    finally:
        _cleanup()


def test_service_area_is_looked_up_then_written(client, monkeypatch):
    g.fake_google(monkeypatch)
    try:
        bid = _import(client)
        sent = _recorder(monkeypatch)
        s = get_settings()
        monkeypatch.setattr(s, "google_places_api_key", "")
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_LOCATION_ONLY", "areas": ["Wagholi, Pune"]}).status_code == 503  # no Places key
        monkeypatch.setattr(s, "google_places_api_key", "k")
        looked = []

        def resolve(names, key, region="in"):
            looked.append(names)
            return [{"name": n, "place_id": f"id-{n}"} for n in names if n != "Nowhere"], [n for n in names if n == "Nowhere"]
        monkeypatch.setattr(gbp, "resolve_places", resolve)
        r = client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_LOCATION_ONLY", "areas": ["Wagholi", "Kharadi", "Nowhere", "wagholi"]})
        assert r.status_code == 200, r.text
        assert r.json()["unresolved"] == ["Nowhere"] and [a["name"] for a in r.json()["areas"]] == ["Wagholi", "Kharadi"]
        body = next(x for x in sent if x[1] == "locations/1")[3]
        assert body == {"serviceArea": {"businessType": "CUSTOMER_LOCATION_ONLY", "places": {"placeInfos": [{"placeName": "Wagholi", "placeId": "id-Wagholi"}, {"placeName": "Kharadi", "placeId": "id-Kharadi"}]}}}
        # Areas already saved are not looked up again
        looked.clear()
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_AND_BUSINESS_LOCATION", "areas": ["Wagholi"]}).status_code == 200 and looked == []
        assert client.get(f"/api/v1/businesses/{bid}/gbp/service-area").json()["type"] == "CUSTOMER_AND_BUSINESS_LOCATION"
        # Rules
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_LOCATION_ONLY", "areas": []}).status_code == 422
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "BAD", "areas": ["x"]}).status_code == 422
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_AND_BUSINESS_LOCATION", "areas": [f"a{i}" for i in range(21)]}).status_code == 422
        # Google refuses: nothing is saved
        def refuse(self, method, url, **kw):
            if method == "PATCH":
                raise gbp.GbpError("nope")
            return {}
        monkeypatch.setattr(gbp.GbpClient, "_req", refuse)
        assert client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_LOCATION_ONLY", "areas": ["Wagholi"]}).status_code == 502
        assert client.get(f"/api/v1/businesses/{bid}/gbp/service-area").json()["type"] == "CUSTOMER_AND_BUSINESS_LOCATION"
    finally:
        _cleanup()


def test_an_unlinked_project_keeps_its_service_area_locally(client):
    bid = client.post("/api/v1/businesses", json={"name": "Local Only Co"}).json()["id"]
    r = client.put(f"/api/v1/businesses/{bid}/gbp/service-area", json={"type": "CUSTOMER_LOCATION_ONLY", "areas": ["Pune", "Mumbai"]})
    assert r.status_code == 200 and [a["name"] for a in r.json()["areas"]] == ["Pune", "Mumbai"] and r.json()["linked"] is False
    got = client.patch(f"/api/v1/businesses/{bid}", json={"open_status": "CLOSED_TEMPORARILY", "labels": ["x"], "more_hours": {"LUNCH": []}}).json()
    assert got["open_status"] == "CLOSED_TEMPORARILY" and got["labels"] == ["x"] and got["pushed_to_google"] == []
