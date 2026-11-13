"""Backlinks synced from our own crawler into the platform's tables. The crawler is a fake (no network)."""
import pytest
from sqlalchemy import func, select

from app.backlinks import bot, crawler_sync
from app.backlinks.models import Backlink, BacklinkProvenance, BiPage
from app.config import get_settings
from app.db import SessionLocal
from app.services import crawler_client as cc


def link(src, anchor="Site", status="verified", active=True, rel=None):
    return {"source_url": src, "destination_url": "https://synced-clinic.in/", "anchor_text": anchor, "rel": rel, "link_status": status,
            "verification_status": status, "first_seen": "2026-11-06 11:25:06", "last_verified": "2026-11-13 12:00:00", "is_active": active}


@pytest.fixture()
def crawler(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "crawler_url", "https://c.example")
    monkeypatch.setattr(s, "crawler_api_key", "k")
    data = {"links": [link("https://blog.one.com/a"), link("https://two.org/x", rel="nofollow ugc"), link("https://three.net/old", status="lost", active=False)]}

    def backlinks(domain, include_removed=False, limit=100, offset=0):
        rows = data["links"] if domain == "synced-clinic.in" else []
        return {"domain": domain, "status": "ok" if rows else "not_found_in_current_index", "backlinks": rows[offset:offset + limit]}
    monkeypatch.setattr(cc, "backlinks", backlinks)
    return data


def _by_source(db):
    return {u: b for b, u in db.execute(select(Backlink, BiPage.normalized_url).join(BiPage, BiPage.id == Backlink.source_page_id))}


def _business(client):
    bid = client.post("/api/v1/businesses", json={"name": "Synced Clinic", "website": "https://www.synced-clinic.in/"}).json()["id"]
    return bid


def test_sync_saves_links_with_the_crawlers_status(client, crawler):
    bid = _business(client)
    db = SessionLocal()
    try:
        st = crawler_sync.run_cycle(db, bid)
        assert st["source"] == "crawler" and st["links_read"] == 3 and st["new_backlinks"] == 3 and st["error"] is None
        rows = _by_source(db)
        live = next(b for u, b in rows.items() if "blog.one.com" in u)
        assert live.current_status == "LIVE" and live.verification_status == "CRAWLER_VERIFIED" and live.link_type == "dofollow"
        nof = next(b for u, b in rows.items() if "two.org" in u)
        assert nof.link_type == "nofollow" and "ugc" in nof.rel_attributes
        assert next(b for u, b in rows.items() if "three.net" in u).current_status == "LOST_CONFIRMED"
        assert db.scalar(select(func.count()).select_from(BacklinkProvenance).where(BacklinkProvenance.source == "codigix_crawler")) >= 3
    finally:
        db.close()


def test_a_second_sync_adds_no_duplicates_and_follows_changes(client, crawler):
    bid = _business(client)
    db = SessionLocal()
    try:
        crawler_sync.run_cycle(db, bid)
        before = db.scalar(select(func.count()).select_from(Backlink))
        crawler["links"][0] = link("https://blog.one.com/a", status="lost", active=False)
        crawler["links"].append(link("https://four.io/new"))
        st = crawler_sync.run_cycle(db, bid)
        assert st["new_backlinks"] == 1
        assert db.scalar(select(func.count()).select_from(Backlink)) == before + 1
        one = next(b for u, b in _by_source(db).items() if "blog.one.com" in u)
        assert one.current_status.startswith("LOST")
    finally:
        db.close()


def test_a_crawler_that_is_down_is_reported_and_keeps_saved_links(client, crawler, monkeypatch):
    bid = _business(client)
    db = SessionLocal()
    try:
        crawler_sync.run_cycle(db, bid)
        saved = db.scalar(select(func.count()).select_from(Backlink))

        def boom(*a, **k):
            raise cc.CrawlerError("The backlink crawler could not be reached: ConnectError")
        monkeypatch.setattr(cc, "backlinks", boom)
        st = crawler_sync.run_cycle(db, bid)
        assert st["error"] and "could not be reached" in st["error"] and st["errors"] == 1
        assert db.scalar(select(func.count()).select_from(Backlink)) == saved
        assert not bot.is_running(bot.get_config(db, bid))  # the run is marked finished, not stuck
    finally:
        db.close()


def test_bot_run_cycle_uses_the_crawler_when_it_is_set_up(client, crawler):
    bid = _business(client)
    db = SessionLocal()
    try:
        out = bot.run_cycle(db, None, bid)  # no fetcher needed: nothing is crawled here
        assert out["source"] == "crawler" and out["links_read"] == 3
        assert bot.status(db, bid)["source"] == "crawler"
    finally:
        db.close()
