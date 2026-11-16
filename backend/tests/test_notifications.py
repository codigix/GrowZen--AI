"""New Google reviews become notifications (and at most one email per sync); the API shows only the user's own projects."""
import test_gbp as g
from test_security import assign, login, user
from app.db import SessionLocal
from app.models import Business, Notification, Review
from app.services import gbp, notify


def _drop_orphans():
    """SQLite reuses ids and does not cascade: rows left by another test's deleted project must not look like this project's."""
    db = SessionLocal()
    live = [b.id for b in db.query(Business)]
    for model in (Notification, Review):
        q = db.query(model)
        (q.filter(~model.business_id.in_(live)) if live else q).delete(synchronize_session=False)
    db.commit()
    db.close()


def _import(client):
    _drop_orphans()
    cid = g.connection()
    return client.post(f"/api/v1/connections/{cid}/import", json={"locations": ["locations/1"]}).json()[0]["id"]


def _cleanup():
    db = SessionLocal()
    ids = [b.id for b in db.query(Business).filter(Business.gbp_location == "locations/1")]
    for model in (Notification, Review):  # SQLite does not cascade; Postgres does
        db.query(model).filter(model.business_id.in_(ids)).delete(synchronize_session=False)
    db.query(Business).filter(Business.gbp_location == "locations/1").delete()
    db.commit()
    db.close()


def _reviews(monkeypatch, items):
    base = gbp.GbpClient._req

    def req(self, method, url, **kw):
        if method == "GET" and url.endswith("/reviews"):
            return {"reviews": items}
        return base(self, method, url, **kw)
    monkeypatch.setattr(gbp.GbpClient, "_req", req)


def _review(i, stars="FIVE", who="Asha", text="Great service"):
    return {"reviewId": f"r{i}", "starRating": stars, "comment": text, "reviewer": {"displayName": who}, "createTime": "2026-11-12T10:00:00Z"}


def test_a_new_review_makes_one_notification_and_a_resync_makes_none(client, monkeypatch):
    g.fake_google(monkeypatch)
    _reviews(monkeypatch, [_review(1)])
    try:
        bid = _import(client)
        got = client.get("/api/v1/notifications", params={"business_id": bid}).json()
        assert len(got) == 1
        n = got[0]
        assert n["title"] == "New 5-star review from Asha" and n["kind"] == "new_review" and n["rating"] == 5 and n["body"] == "Great service"
        assert n["link"] == "/gmb-profile?tab=reviews" and n["read"] is False and n["business_name"] and n["review_id"]
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        assert len(client.get("/api/v1/notifications", params={"business_id": bid}).json()) == 1  # the same review is not news twice
        # A low rating, later, is flagged as such
        _reviews(monkeypatch, [_review(1), _review(2, "ONE", "Ravi", "x" * 300)])
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        latest = client.get("/api/v1/notifications", params={"business_id": bid, "unread": "true"}).json()
        assert latest[0]["kind"] == "low_rating_review" and latest[0]["title"] == "New 1-star review from Ravi" and len(latest[0]["body"]) == 160
        # Reading
        assert client.post(f"/api/v1/notifications/{latest[0]['id']}/read").json()["read"] is True
        assert len(client.get("/api/v1/notifications", params={"business_id": bid, "unread": "true"}).json()) == 1
        assert client.post("/api/v1/notifications/read-all", params={"business_id": bid}).json()["marked"] == 1
        assert client.get("/api/v1/notifications", params={"business_id": bid, "unread": "true"}).json() == []
    finally:
        _cleanup()


def test_a_first_sync_with_many_reviews_is_one_summary(client, monkeypatch):
    g.fake_google(monkeypatch)
    _reviews(monkeypatch, [_review(i) for i in range(1, 9)])
    try:
        bid = _import(client)
        got = client.get("/api/v1/notifications", params={"business_id": bid}).json()
        assert len(got) == 1 and got[0]["title"] == "8 reviews imported from Google"
    finally:
        _cleanup()


def test_only_the_projects_owner_sees_them(client, monkeypatch):
    g.fake_google(monkeypatch)
    _reviews(monkeypatch, [_review(1)])
    user("owner-n@x.in", "editor")
    user("other-n@x.in", "editor")
    try:
        bid = _import(client)
        assign(bid, "owner-n@x.in")
        mine, _ = login("owner-n@x.in")
        theirs, _ = login("other-n@x.in")
        assert len(mine.get("/api/v1/notifications").json()) == 1
        assert theirs.get("/api/v1/notifications").json() == []
        assert theirs.get("/api/v1/notifications", params={"business_id": bid}).status_code == 404
        nid = mine.get("/api/v1/notifications").json()[0]["id"]
        assert theirs.post(f"/api/v1/notifications/{nid}/read").status_code == 404
        assert theirs.post("/api/v1/notifications/read-all", params={"business_id": bid}).status_code == 404
        assert mine.get("/api/v1/notifications", params={"unread": "true"}).json()[0]["read"] is False
    finally:
        _cleanup()


def test_one_email_per_sync_and_none_without_smtp(client, monkeypatch):
    g.fake_google(monkeypatch)
    sent = []
    monkeypatch.setattr(notify, "send_email", lambda to, subject, body, attachments=None: sent.append((to, subject, body)) or True)
    _reviews(monkeypatch, [_review(1)])
    try:
        bid = _import(client)
        assert sent == []  # SMTP is not configured in tests: nothing is sent, the notification still exists
        assert client.get("/api/v1/notifications", params={"business_id": bid}).json()[0]["emailed"] is False
        from app.config import get_settings
        s = get_settings()
        monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
        monkeypatch.setattr(s, "smtp_from", "no-reply@example.com")
        assert client.patch(f"/api/v1/businesses/{bid}", json={"contact_email": "owner@saidental.in"}).status_code == 200
        _reviews(monkeypatch, [_review(1), _review(2, "FOUR", "Mina", "Good"), _review(3, "FIVE", "Zoya", "Lovely")])
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        assert len(sent) == 1 and sent[0][0] == "owner@saidental.in" and "2 new reviews" in sent[0][1]
        db = SessionLocal()
        assert db.query(Notification).filter(Notification.business_id == bid, Notification.emailed.is_(True)).count() == 2
        db.close()
        # A mail failure never breaks the sync
        monkeypatch.setattr(notify, "send_email", lambda *a, **k: (_ for _ in ()).throw(OSError("smtp down")))
        _reviews(monkeypatch, [_review(i) for i in range(1, 5)])
        assert client.post(f"/api/v1/businesses/{bid}/sync").status_code == 200
        assert len(client.get("/api/v1/notifications", params={"business_id": bid}).json()) == 4
    finally:
        _cleanup()
