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
    monkeypatch.setattr(cc, "onboard_business", lambda d: {"created": False, "job": {}})  # never register test domains with the real crawler
    monkeypatch.setattr(cc, "add_competitors", lambda b, ds: {"business": b, "domains": ds})
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
        out = bot.run_cycle(db, bid)  # nothing is crawled here
        assert out["source"] == "crawler" and out["links_read"] == 3
        assert bot.status(db, bid)["source"] == "crawler"
    finally:
        db.close()


def test_a_domain_the_crawler_has_never_seen_is_handed_to_it_as_a_seed(client, crawler, monkeypatch):
    seen = []
    monkeypatch.setattr(cc, "seed", lambda urls: seen.append(list(urls)) or {"queued": urls})
    bid = client.post("/api/v1/businesses", json={"name": "Unknown Co", "website": "https://never-crawled.example/"}).json()["id"]
    db = SessionLocal()
    try:
        st = crawler_sync.run_cycle(db, bid)
        assert st["error"] is None and st["links_read"] == 0 and st["seeded"] == 1 and seen == [["https://never-crawled.example/"]]
    finally:
        db.close()


def test_onboarding_registers_the_new_domain_with_the_crawler(client, crawler, monkeypatch):
    from app.backlinks import autostart
    from app.models import Business
    calls: list[str] = []
    monkeypatch.setattr(cc, "onboard_business", lambda d: calls.append(d) or {"created": True, "job": {"id": 1}})
    bid = _business(client)
    db = SessionLocal()
    try:
        out = autostart.enable(db, db.get(Business, bid))
        assert calls == ["synced-clinic.in"] and out["crawler"]["registered"] == ["synced-clinic.in"]
        autostart.enable(db, db.get(Business, bid))  # onboarding again adds no target, so nothing is sent again
        assert calls == ["synced-clinic.in"]
    finally:
        db.close()


def test_registration_never_breaks_onboarding_and_is_retried_by_the_sync(client, crawler, monkeypatch):
    calls: list[str] = []

    def down(d):
        calls.append(d)
        raise cc.CrawlerError("The backlink crawler could not be reached: ConnectError")
    monkeypatch.setattr(cc, "onboard_business", down)
    bid = _business(client)
    db = SessionLocal()
    try:
        from app.backlinks import autostart
        from app.models import Business
        assert autostart.enable(db, db.get(Business, bid))["enabled"] is True  # no exception
        monkeypatch.setattr(cc, "onboard_business", lambda d: calls.append("retry:" + d) or {"created": True})
        st = crawler_sync.run_cycle(db, bid)
        assert "retry:synced-clinic.in" in calls and st["registered"]["registered"] == ["synced-clinic.in"]
    finally:
        db.close()


def test_a_competitor_added_by_hand_is_sent_with_the_business_it_belongs_to(client, crawler, monkeypatch):
    own: list[str] = []
    comp: list[tuple] = []
    monkeypatch.setattr(cc, "onboard_business", lambda d: own.append(d) or {"created": True})
    monkeypatch.setattr(cc, "add_competitors", lambda b, ds: comp.append((b, tuple(ds))) or {})
    bid = _business(client)
    from app.backlinks import autostart
    from app.models import Business
    db = SessionLocal()
    try:
        autostart.enable(db, db.get(Business, bid))  # the business itself is tracked first
    finally:
        db.close()
    assert own == ["synced-clinic.in"] and comp == []
    r = client.post(f"/api/v1/businesses/{bid}/backlink-intel/targets", json={"domain": "https://www.rival-shop.com/", "is_competitor": True})
    assert r.status_code == 201, r.text
    assert comp == [("synced-clinic.in", ("rival-shop.com",))] and own == ["synced-clinic.in"]  # a competitor is not onboarded as a business
    client.post(f"/api/v1/businesses/{bid}/backlink-intel/targets", json={"domain": "rival-shop.com", "is_competitor": True})
    assert len(comp) == 1  # already tracked: nothing is sent again


def test_competitors_found_or_typed_for_a_business_reach_the_crawler(client, crawler, monkeypatch):
    from app.competitors import service
    comp: list[tuple] = []
    monkeypatch.setattr(cc, "add_competitors", lambda b, ds: comp.append((b, tuple(sorted(ds)))) or {})
    bid = _business(client)
    found = [{"name": "Rival One", "website": "https://rival-one.com", "rating": 4.5, "reviews": 10, "address": "x", "phone": "1", "maps_link": "m"},
             {"name": "Rival Two", "website": "https://rival-two.com", "rating": 4.0, "reviews": 5, "address": "y", "phone": "2", "maps_link": "n"}]
    monkeypatch.setattr(service, "find_competitors", lambda *a, **k: found)
    r = client.post("/api/v1/competitors", json={"business_type": "clinic", "location": "Pune", "business_id": bid})  # "found" on Google Maps
    assert r.status_code == 200, r.text
    assert not comp  # found, not chosen: nothing is tracked or sent until the competitor is chosen
    for item in r.json()["registered"]:
        assert client.patch(f"/api/v1/competitors/{item['id']}", json={"selected": True}).status_code == 200
    assert comp and comp[-1] == ("synced-clinic.in", ("rival-one.com", "rival-two.com"))  # choosing sends the chosen list
    r = client.post("/api/v1/competitors/manual", json={"business_id": bid, "url": "rival-three.com"})  # typed by hand: chosen at once
    assert r.status_code == 201, r.text
    assert comp[-1] == ("synced-clinic.in", ("rival-one.com", "rival-three.com", "rival-two.com"))  # the whole chosen list is sent each time


def test_the_sync_registers_the_business_and_its_competitors_again(client, crawler, monkeypatch):
    own: list[str] = []
    comp: list[tuple] = []
    monkeypatch.setattr(cc, "onboard_business", lambda d: own.append(d) or {"created": False})
    monkeypatch.setattr(cc, "add_competitors", lambda b, ds: comp.append((b, tuple(ds))) or {})
    bid = _business(client)
    client.post(f"/api/v1/businesses/{bid}/backlink-intel/targets", json={"domain": "rival-shop.com", "is_competitor": True})
    own.clear(); comp.clear()
    db = SessionLocal()
    try:
        st = crawler_sync.run_cycle(db, bid)
    finally:
        db.close()
    assert set(own) == {"synced-clinic.in"} and comp[-1] == ("synced-clinic.in", ("rival-shop.com",)) and st["competitors_registered"]["failed"] is None


def test_competitors_a_research_run_finds_are_listed_but_only_chosen_ones_are_watched_and_sent_to_the_crawler(client, crawler, monkeypatch):
    from app.backlinks import watch
    from app.competitors import intel_router
    from app.models import Business, Competitor
    comp: list[tuple] = []
    monkeypatch.setattr(cc, "add_competitors", lambda b, ds: comp.append((b, tuple(sorted(ds)))) or {})
    bid = _business(client)
    result = {"local_competitors": [
        {"name": "Awrange", "website": "https://awrange.com/digital-marketing/", "domain": "awrange.com", "rating": 5, "reviews": 238, "phone": "1", "address": "Pune"},
        {"name": "Ad2brand", "website": "https://www.ad2brand.com/", "domain": "ad2brand.com", "rating": 4.8, "reviews": 10},
        {"name": "Own site", "website": "https://www.synced-clinic.in/about", "domain": "synced-clinic.in"},   # the business itself: never a competitor
        {"name": "Insta", "website": "https://www.instagram.com/rival", "domain": "instagram.com"},          # a social page: never a competitor
        {"name": "No site", "website": "", "domain": ""}],
        "organic_competitors": [{"domain": "magemarketer.com", "type": "organic"}, {"domain": "awrange.com", "type": "organic"}]}
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        assert intel_router.save_found(db, b, result) == 3
        rows = {c.domain: c for c in db.query(Competitor).filter_by(business_id=bid)}
        assert set(rows) == {"awrange.com", "ad2brand.com", "magemarketer.com"}
        assert all(c.selected is False for c in rows.values())  # found, not chosen
        assert rows["awrange.com"].discovery == ["google_places"] and rows["magemarketer.com"].discovery == ["organic_serp"]  # how each was found is kept
        assert intel_router.save_found(db, b, result) == 0  # the same run again adds nothing
        assert watch.competitor_domains(db, bid) == [] and not comp  # nothing is watched or sent to the crawler until the owner chooses
        # the owner chooses one: it is watched and sent, and only it
        assert client.patch(f"/api/v1/competitors/{rows['awrange.com'].id}", json={"selected": True}).status_code == 200
        db.expire_all()
        assert watch.competitor_domains(db, bid) == ["awrange.com"]
        assert comp[-1] == ("synced-clinic.in", ("awrange.com",))
        names = [c["name"] for c in client.get(f"/api/v1/businesses/{bid}/competitor-watch").json()["competitors"]]
        assert names == ["Awrange"]
        # and takes it out again: gone from the watch
        assert client.patch(f"/api/v1/competitors/{rows['awrange.com'].id}", json={"selected": False}).status_code == 200
        db.expire_all()
        assert watch.competitor_domains(db, bid) == []
        assert client.get(f"/api/v1/businesses/{bid}/competitor-watch").json()["competitors"] == []
    finally:
        db.close()


def test_a_report_made_for_other_competitors_says_nothing_about_them(client):
    from datetime import date
    from app.backlinks import watch
    from app.backlinks.models import WatchReport
    from app.db import SessionLocal
    from app.models import Competitor
    bid = client.post("/api/v1/businesses", json={"name": "Old Report Co", "website": "https://oldreport.example", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add(Competitor(business_id=bid, website="https://now-chosen.com", name="Now", source="manual", selected=True, domain="now-chosen.com"))
    from datetime import datetime, timezone
    db.add(WatchReport(business_id=bid, week_start=date(2026, 11, 23), created_at=datetime.now(timezone.utc), source="rules", events=0, baseline=True,
                       summary={"headline": "Now watching 2 competitor site(s)", "summary": "We recorded 129 pages across old-a.com, old-b.com.", "what_it_means": "x", "actions": [], "highlights": ["old-a.com", "old-b.com"]}))
    db.commit()
    from app.models import Business
    out = watch.status(db, db.get(Business, bid))
    db.close()
    assert out["latest"]["outdated"] is True and out["latest"]["other_sites"] == ["old-a.com", "old-b.com"] and out["latest"]["summary"] == ""
