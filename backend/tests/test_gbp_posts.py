"""Posts on Google: offer and event bodies, the rules checked before sending, and editing a post that is already live."""
from datetime import date, timedelta

from app.db import SessionLocal
from app.models import Business
from app.services import gbp
from test_gbp import connection, fake_google


def _iso(days):
    return (date.today() + timedelta(days=days)).isoformat()


def _linked(client, monkeypatch):
    fake_google(monkeypatch)
    cid = connection()
    bid = client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]
    sent = []
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if method in ("PATCH", "POST", "PUT", "DELETE") and "/revoke" not in url:
            sent.append((method, url.split("/v1/")[-1].split("/v4/")[-1], kw.get("params"), kw.get("json")))
            return {"name": "accounts/111/locations/1/localPosts/new1"}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)
    return bid, sent


def _cleanup():
    db = SessionLocal()
    db.query(Business).filter(Business.gbp_location == "locations/1").delete()
    db.commit()
    db.close()


def test_offer_and_event_bodies_carry_their_dates_and_details():
    c = gbp.GbpClient.__new__(gbp.GbpClient)
    sent = []
    c._req = lambda method, url, **kw: sent.append((method, url, kw["json"])) or {}
    c.create_post("accounts/111", "locations/1", {"post_type": "Offer", "title": "20% off", "body": "Weekend sale", "cta_type": "ORDER", "cta_url": "https://x.in/o",
                                                 "starts_on": date(2030, 1, 1), "ends_on": "2030-01-03", "coupon_code": "SAVE20", "redeem_url": "https://x.in/r", "terms": "One per customer"})
    body = sent[-1][2]
    assert body["topicType"] == "OFFER" and body["event"]["title"] == "20% off"
    assert body["event"]["schedule"] == {"startDate": {"year": 2030, "month": 1, "day": 1}, "endDate": {"year": 2030, "month": 1, "day": 3}}
    assert body["offer"] == {"couponCode": "SAVE20", "redeemOnlineUrl": "https://x.in/r", "termsConditions": "One per customer"}
    c.create_post("accounts/111", "locations/1", {"post_type": "Event", "title": "Open day", "body": "Come", "cta_type": "CALL",
                                                 "starts_on": "2030-02-01", "ends_on": "2030-02-01", "start_time": "10:00", "end_time": "13:30"})
    body = sent[-1][2]
    assert body["topicType"] == "EVENT" and "offer" not in body and body["callToAction"] == {"actionType": "CALL"}  # Call has no link
    assert body["event"]["schedule"]["startTime"] == {"hours": 10, "minutes": 0} and body["event"]["schedule"]["endTime"] == {"hours": 13, "minutes": 30}
    # No dates given: a week from today
    c.create_post("accounts/111", "locations/1", {"post_type": "Offer", "title": "Sale", "body": "x"})
    sch = sent[-1][2]["event"]["schedule"]
    assert sch["startDate"]["day"] == date.today().day and sch["endDate"] != sch["startDate"]


def test_posts_are_checked_before_they_are_saved(client):
    bid = client.post("/api/v1/businesses", json={"name": "Post Rules Co"}).json()["id"]
    url = f"/api/v1/businesses/{bid}/posts"
    ok = client.post(url, json={"post_type": "Offer", "title": "Sale", "body": "Big sale", "starts_on": _iso(1), "ends_on": _iso(3), "coupon_code": "A1", "redeem_url": "https://x.in/r", "terms": "t"})
    assert ok.status_code == 201 and ok.json()["coupon_code"] == "A1" and ok.json()["starts_on"] == _iso(1)
    assert client.post(url, json={"post_type": "Offer", "body": "no title"}).status_code == 422
    assert client.post(url, json={"post_type": "Event", "title": "E", "body": "x", "starts_on": _iso(1)}).status_code == 422  # both dates
    assert client.post(url, json={"post_type": "Event", "title": "E", "body": "x"}).status_code == 422
    assert client.post(url, json={"post_type": "Offer", "title": "O", "body": "x", "starts_on": _iso(5), "ends_on": _iso(2)}).status_code == 422  # ends before it starts
    assert client.post(url, json={"post_type": "Offer", "title": "O", "body": "x", "starts_on": _iso(1), "ends_on": _iso(500)}).status_code == 422  # more than a year ahead
    assert client.post(url, json={"post_type": "Event", "title": "E", "body": "x", "starts_on": _iso(1), "ends_on": _iso(1), "start_time": "14:00", "end_time": "13:00"}).status_code == 422
    assert client.post(url, json={"post_type": "Event", "title": "E", "body": "x", "starts_on": _iso(1), "ends_on": _iso(2), "start_time": "9am"}).status_code == 422
    assert client.post(url, json={"post_type": "Offer", "title": "O", "body": "x", "redeem_url": "nope"}).status_code == 422
    plain = client.post(url, json={"post_type": "Update", "body": "hi", "coupon_code": "X", "starts_on": _iso(1)})  # an update carries no offer or schedule
    assert plain.status_code == 201 and plain.json()["coupon_code"] is None and plain.json()["starts_on"] is None


def test_a_live_post_can_be_edited_only_on_its_own_profile(client, monkeypatch):
    bid, sent = _linked(client, monkeypatch)
    try:
        name = "accounts/111/locations/1/localPosts/p1"
        url = f"/api/v1/businesses/{bid}/gbp/live-post"
        client.post(f"/api/v1/businesses/{bid}/sync")
        r = client.patch(url, json={"name": name, "summary": "Updated text", "cta_type": "BOOK", "cta_url": "https://saidental.in/book2"})
        assert r.status_code == 200, r.text
        m, path, params, body = sent[-1]
        assert m == "PATCH" and path == name and params == {"updateMask": "summary,callToAction"} and body["summary"] == "Updated text" and body["callToAction"] == {"actionType": "BOOK", "url": "https://saidental.in/book2"}
        live = client.get(f"/api/v1/businesses/{bid}/gbp/live").json()["live"]["posts"]
        assert next(p for p in live if p["id"] == name)["summary"] == "Updated text"  # the list shows the change at once
        # Dates of an offer or event go in the event block
        r = client.patch(url, json={"name": name, "summary": "Sale", "title": "Sale", "starts_on": _iso(1), "ends_on": _iso(2), "cta_type": "CALL"})
        assert r.status_code == 200 and sent[-1][2]["updateMask"] == "summary,callToAction,event" and sent[-1][3]["callToAction"] == {"actionType": "CALL"}
        n = len(sent)
        # Someone else's post, bad input: refused before anything is sent
        assert client.patch(url, json={"name": "accounts/999/locations/9/localPosts/x", "summary": "hack"}).status_code == 400
        assert client.patch(url, json={"name": name, "summary": ""}).status_code == 422
        assert client.patch(url, json={"name": name, "summary": "x", "cta_type": "BOOK"}).status_code == 422  # a button needs a link
        assert client.patch(url, json={"name": name, "summary": "x", "starts_on": _iso(4), "ends_on": _iso(2), "title": "T"}).status_code == 422
        assert client.patch(url, json={"name": name, "summary": "x", "starts_on": _iso(1), "ends_on": _iso(2)}).status_code == 422  # dates need a title
        assert len(sent) == n
    finally:
        _cleanup()
