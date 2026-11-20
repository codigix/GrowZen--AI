from datetime import datetime, timedelta, timezone

from app.db import SessionLocal
from app.models import Business, Notification
from app.services import google_changes as gc


def _biz(client):
    d = SessionLocal()
    d.query(Notification).filter_by(kind="google_changes").delete()
    d.commit()
    d.close()
    return client.post("/api/v1/businesses", json={"name": "Watch Co", "website": "https://watch.example/"}).json()["id"]


def test_record_collects_what_was_sent_and_names_it_plainly():
    b = Business(name="x")
    gc.record(b, ["profile", "phoneNumbers"])
    gc.record(b, ["serviceItems", "profile"])
    assert b.google_watch["fields"] == ["phoneNumbers", "profile", "serviceItems"] and b.google_watch["notified"] is False
    assert gc.describe(b.google_watch["fields"]) == "phone numbers, description, services"
    gc.record(b, [])  # nothing sent: nothing changes
    assert len(b.google_watch["fields"]) == 3


def test_the_owner_is_told_when_google_finishes_its_review(client, monkeypatch):
    bid = _biz(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        b.gbp_location = "locations/watch-test-1"
        class Conn: id = 1
        monkeypatch.setattr(Business, "connection", property(lambda self: Conn()), raising=False)
        state = {"pending": True}
        monkeypatch.setattr(gc, "_live", lambda biz: not state["pending"])
        gc.record(b, ["profile"])
        db.commit()
        assert gc.check(db, b, force=True) == "waiting" and b.google_watch
        assert db.query(Notification).filter_by(business_id=bid, kind="google_changes").count() == 0
        state["pending"] = False
        assert gc.check(db, b, force=True) == "live" and b.google_watch is None
        n = db.query(Notification).filter_by(business_id=bid, kind="google_changes").one()
        assert "now shows your changes" in n.title and "description" in n.body
    finally:
        db.query(Notification).filter_by(kind="google_changes").delete()  # leave nothing behind for the other tests (SQLite does not cascade)
        db.delete(db.get(Business, bid))
        db.commit()
        db.close()


def test_it_gives_up_with_an_honest_message_after_five_days(client, monkeypatch):
    bid = _biz(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        b.gbp_location = "locations/watch-test-2"
        class Conn: id = 1
        monkeypatch.setattr(Business, "connection", property(lambda self: Conn()), raising=False)
        monkeypatch.setattr(gc, "_live", lambda biz: False)
        b.google_watch = {"since": (datetime.now(timezone.utc) - timedelta(days=6)).isoformat(), "fields": ["profile"], "last_check": None, "notified": False}
        db.commit()
        assert gc.check(db, b, force=True) == "stale"
        assert "has not shown" in db.query(Notification).filter_by(business_id=bid, kind="google_changes").one().title
    finally:
        db.query(Notification).filter_by(kind="google_changes").delete()  # leave nothing behind for the other tests (SQLite does not cascade)
        db.delete(db.get(Business, bid))
        db.commit()
        db.close()
