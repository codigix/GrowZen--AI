"""Growth Plan measurements: real numbers with their source, a reason instead of a made-up value, area states, presence and daily snapshots."""
from datetime import date, datetime, timedelta, timezone

import pytest
import test_gbp as g

from app.db import SessionLocal
from app.models import (Business, CatalogItem, ChatGPTBusiness, GeoPrompt, GeoResult, GrowthSnapshot, InsightDay, PageXRayRun, Post, Review)
from app.services import geo, growth_metrics as gm, page_xray

NOW = datetime.now(timezone.utc)
KEYS = set(gm.UNITS)


def _clean(db):
    """SQLite reuses ids and does not cascade: rows left by another test's deleted project must not look like this project's."""
    live = [b.id for b in db.query(Business)]
    for model in (Review, Post, InsightDay, PageXRayRun, GrowthSnapshot, ChatGPTBusiness, CatalogItem, GeoResult, GeoPrompt):
        q = db.query(model)
        (q.filter(~model.business_id.in_(live)) if live else q).delete(synchronize_session=False)
    db.commit()


@pytest.fixture
def db():
    s = SessionLocal()
    _clean(s)
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Offline by default: a test that expects a live X-Ray patches this itself."""
    monkeypatch.setattr(page_xray, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("measure(live=False) must not fetch anything")))
    monkeypatch.setattr(geo, "engine_status", lambda: [{"engine": "Claude", "connected": False}])


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Asha Rentals", "primary_category": "Clothing rental", "city": "Pune", "phone": "+91 98765 43210",
                                                "website": "https://asha.example", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _report(seo=78, aeo=40, geo_=60, faq=False, org=True, days_left=50, headers=4):
    def checks(area, spec):
        return [{"key": k, "label": k, "passed": ok, "weight": 5, "detail": "", "fix": ""} for k, ok in spec]
    return {"url": "https://asha.example/", "final_url": "https://asha.example/", "status": 200,
            "scores": {"seo": {"score": seo, "passed": 10, "total": 14, "checks": checks("seo", [("title", True)])},
                       "aeo": {"score": aeo, "passed": 3, "total": 9, "checks": checks("aeo", [("faq_schema", faq), ("direct_answer", True)])},
                       "geo": {"score": geo_, "passed": 6, "total": 10, "checks": checks("geo", [("org_schema", org)])}},
            "tech": {"security_headers": {"hsts": True, "csp": False, "x_frame_options": True, "x_content_type_options": True, "referrer_policy": True, "permissions_policy": False}
                     if headers == 4 else {}},
            "ssl": {"days_left": days_left, "valid": True, "error": None},
            "robots": {"ai_crawlers": [{"bot": b, "allowed": i < 5} for i, b in enumerate(["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"])]},
            "llms_txt": {"found": False}, "content": {"word_count": 800}}


def _store_xray(db, bid, report=None, age_hours=1, url="https://asha.example/"):
    r = report or _report()
    row = PageXRayRun(business_id=bid, url=url, final_url=url, seo_score=r["scores"]["seo"]["score"], aeo_score=r["scores"]["aeo"]["score"],
                      geo_score=r["scores"]["geo"]["score"], report=r, source="server")
    db.add(row)
    db.flush()
    row.created_at = NOW - timedelta(hours=age_hours)
    db.commit()


def _link(db, bid, **fields):
    cid = g.connection()
    b = db.get(Business, bid)
    b.gbp_account, b.gbp_location, b.connection_id, b.verification = "accounts/111", f"locations/g{bid}", cid, "verified"
    for k, v in fields.items():
        setattr(b, k, v)
    db.commit()
    return b


# ---------------------------------------------------------------------------------------------------- contract
def test_contract_shape_and_every_key_is_present(client, db):
    bid = _project(client)
    d = gm.measure(db, db.get(Business, bid))
    assert set(d) == {"at", "metrics", "areas", "presence", "weights"} and d["weights"] == {"gmb": 30, "local": 15, "seo": 20, "aeo": 10, "geo": 15, "chatgpt": 10}
    assert set(d["metrics"]) == KEYS and len(KEYS) == 37
    for key, m in d["metrics"].items():
        assert set(m) == {"value", "unit", "area", "source", "available", "reason"}, key
        assert m["area"] == key.split(".")[0] and m["available"] == (m["value"] is not None)
        if m["value"] is None:
            assert m["reason"], f"{key} is null without a reason"  # a missing number always says why
    assert list(d["areas"]) == ["gmb", "local", "seo", "aeo", "geo", "chatgpt"]
    for a in d["areas"].values():
        assert set(a) == {"score", "state", "blockers"} and a["state"] in ("measured", "blocked", "not_started") and isinstance(a["blockers"], list)
    datetime.fromisoformat(d["at"])
    assert gm.metric(d, "gmb.profile_score") == d["metrics"]["gmb.profile_score"]["value"] and gm.metric(d, "nope") is None


# ---------------------------------------------------------------------------------------------------- Google profile
def test_a_project_not_linked_to_google_is_blocked_and_never_shows_zeros(client, db):
    d = gm.measure(db, db.get(Business, _project(client)))
    gmb = d["areas"]["gmb"]
    assert gmb["state"] == "blocked" and gmb["score"] is None and gmb["blockers"] == ["Connect the Google account to measure the profile"]
    for k in ("gmb.views_30d", "gmb.calls_30d", "gmb.directions_30d", "gmb.website_clicks_30d", "gmb.verified", "gmb.reviews_total", "gmb.rating", "gmb.photos_total", "gmb.posts_30d", "gmb.reply_rate"):
        m = d["metrics"][k]
        assert m["value"] is None and m["available"] is False and "Connect the Google account" in m["reason"], k
    assert d["metrics"]["gmb.profile_score"]["available"] and d["metrics"]["gmb.completeness"]["value"] is not None  # what the system itself holds is measured


def test_linked_profile_metrics_are_counted_from_stored_rows(client, db):
    bid = _project(client, description="x" * 260)
    b = _link(db, bid, review_count=5, rating=4.6, photo_count=12, logo="https://l.example/a.png", cover_photo="https://l.example/c.png", attributes=["Wi-Fi"],
              services=[{"name": "Lehenga"}], hours={"periods": [{"openDay": "MONDAY"}]}, address="12 MG Road",
              gbp_status={"live": {"posts": [{"id": "p-live-1", "created": (NOW - timedelta(days=3)).isoformat()}, {"id": "p-old", "created": (NOW - timedelta(days=90)).isoformat()},
                                              {"id": "p-both", "created": (NOW - timedelta(days=2)).isoformat()}]}})
    db.add_all([Review(business_id=bid, external_id="r1", rating=5, review_at=NOW - timedelta(days=2), review_date=(NOW - timedelta(days=2)).date(), reply_status="posted"),
                Review(business_id=bid, external_id="r2", rating=4, review_at=NOW - timedelta(days=40), review_date=(NOW - timedelta(days=40)).date(), reply_status="none"),
                Review(business_id=bid, external_id="r3", rating=5, review_date=(NOW - timedelta(days=5)).date(), reply_status="none"),  # an older row with only a date
                Post(business_id=bid, post_type="Update", body="hi", status="published", published_at=NOW - timedelta(days=4), external_id="p-both"),
                Post(business_id=bid, post_type="Update", body="old", status="published", published_at=NOW - timedelta(days=60), external_id="p-x"),
                Post(business_id=bid, post_type="Update", body="draft", status="draft")])
    for i in range(3):
        db.add(InsightDay(business_id=bid, day=date.today() - timedelta(days=i + 1), calls=2, directions=3, website_clicks=1, views_search=10, views_maps=5))
    db.add(InsightDay(business_id=bid, day=date.today() - timedelta(days=80), calls=99, directions=99, website_clicks=99, views_search=999, views_maps=999))
    db.commit()
    d = gm.measure(db, db.get(Business, bid))
    v = lambda k: d["metrics"][k]["value"]  # noqa: E731
    assert (v("gmb.reviews_total"), v("gmb.rating"), v("gmb.photos_total"), v("gmb.verified")) == (5, 4.6, 12, 1)
    assert v("gmb.reviews_30d") == 2 and "5 reviews but only 3" in d["metrics"]["gmb.reviews_30d"]["reason"]  # the 40-day-old one is outside the window; the gap is said, not hidden
    assert v("gmb.reply_rate") == 33 and v("gmb.unanswered") == 2
    assert v("gmb.posts_30d") == 2  # the published row (also live: counted once) and the other live post; the 90-day-old and the draft are not counted
    assert (v("gmb.views_30d"), v("gmb.calls_30d"), v("gmb.directions_30d"), v("gmb.website_clicks_30d")) == (45, 6, 9, 3)  # the 80-day-old day is outside the window
    assert v("gmb.completeness") == 100
    from app.routers.gbp_local_seo import _reviews_score
    expect = round((v("gmb.profile_score") + _reviews_score(4.6, 5)) / 2)
    assert d["areas"]["gmb"] == {"score": expect, "state": "measured", "blockers": []}


# ---------------------------------------------------------------------------------------------------- local
def test_local_area_is_scored_from_real_parts_and_says_when_nothing_is_tracked(client, db):
    d = gm.measure(db, db.get(Business, _project(client)))
    assert d["areas"]["local"]["state"] == "measured" and d["areas"]["local"]["score"] is not None
    assert d["metrics"]["local.keywords_tracked"]["value"] == 0 and d["areas"]["local"]["blockers"] == ["Track at least one search to include rankings in this score"]
    assert d["metrics"]["local.maps_top3"]["value"] is None and d["metrics"]["local.maps_top3"]["reason"] == "Track at least one search"
    assert d["metrics"]["local.keywords_page1"]["value"] is None
    assert d["metrics"]["local.citations_verified"]["value"] == 0 and d["metrics"]["local.citations_listed"]["available"]


# ---------------------------------------------------------------------------------------------------- website
def test_stored_fresh_xray_feeds_the_website_areas_without_any_fetch(client, db):
    bid = _project(client)
    _store_xray(db, bid, _report(seo=78, aeo=40, geo_=60, faq=False, org=True, days_left=50, headers=4), age_hours=3)
    d = gm.measure(db, db.get(Business, bid), live=False)  # page_xray.run is patched to fail: nothing may be fetched
    v = lambda k: d["metrics"][k]["value"]  # noqa: E731
    assert (v("seo.xray_seo"), v("seo.security_headers"), v("seo.ssl_days_left")) == (78, 4, 50)
    assert (v("aeo.score"), v("aeo.faq_schema"), v("aeo.direct_answer")) == (40, 0, 1)
    assert (v("geo.score"), v("geo.ai_bots_allowed"), v("geo.llms_txt"), v("geo.org_schema")) == (60, 5, 0, 1)
    assert d["metrics"]["seo.xray_seo"]["source"] == "page_xray"
    # seo area: security (4/6 = 66.7) and ssl (>= 30 days = 100); no audits in this project
    assert d["areas"]["seo"] == {"score": round((4 / 6 * 100 + 100) / 2), "state": "measured", "blockers": []}
    assert d["areas"]["aeo"]["score"] == 40 and d["areas"]["geo"]["score"] == 60  # no AI engine answered: GEO is the website readiness alone
    assert d["metrics"]["geo.share_of_voice"]["value"] is None and d["metrics"]["geo.share_of_voice"]["reason"] == "No AI engine is connected"


def test_share_of_voice_blends_into_geo_only_when_a_real_engine_answered(client, db, monkeypatch):
    bid = _project(client)
    _store_xray(db, bid, _report(geo_=60))
    monkeypatch.setattr(geo, "engine_status", lambda: [{"engine": "Claude", "connected": True}])
    d = gm.measure(db, db.get(Business, bid))
    assert d["metrics"]["geo.share_of_voice"]["reason"] == "No AI-visibility check has run yet" and d["areas"]["geo"]["score"] == 60
    p = GeoPrompt(business_id=bid, prompt="best clothing rental in pune")
    db.add(p)
    db.flush()
    db.add(GeoResult(business_id=bid, prompt_id=p.id, engine="Claude", mentioned=True, data_source="live"))
    db.commit()
    d = gm.measure(db, db.get(Business, bid))
    assert d["metrics"]["geo.share_of_voice"]["value"] == 100
    assert d["areas"]["geo"]["score"] == round(60 * 0.7 + 100 * 0.3)
    db.query(GeoResult).filter(GeoResult.business_id == bid).update({"data_source": "sample"})
    db.commit()
    assert gm.measure(db, db.get(Business, bid))["metrics"]["geo.share_of_voice"]["value"] is None  # sample answers never count


def test_a_stale_xray_is_not_used_and_live_runs_and_keeps_one(client, db, monkeypatch):
    bid = _project(client)
    _store_xray(db, bid, _report(), age_hours=30)
    d = gm.measure(db, db.get(Business, bid), live=False)
    for k in gm.WEBSITE_KEYS:
        assert d["metrics"][k]["value"] is None and d["metrics"][k]["reason"] == gm.NO_XRAY, k
    assert d["areas"]["aeo"] == {"score": None, "state": "blocked", "blockers": [gm.NO_XRAY]} and d["areas"]["geo"]["state"] == "blocked"
    calls = []
    monkeypatch.setattr(page_xray, "run", lambda url, *a, **k: calls.append(url) or _report(seo=90, aeo=55, geo_=70))
    d = gm.measure(db, db.get(Business, bid), live=True)
    assert calls == ["https://asha.example/"] and d["metrics"]["aeo.score"]["value"] == 55  # only the project's own homepage was read
    assert db.query(PageXRayRun).filter(PageXRayRun.business_id == bid).count() == 2  # the live run is kept in the history
    monkeypatch.setattr(page_xray, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the saved run must be reused")))
    assert gm.measure(db, db.get(Business, bid), live=False)["metrics"]["aeo.score"]["value"] == 55
    # a run of a different page does not count as the homepage
    other = _project(client, name="Other Co", website="https://other.example")
    _store_xray(db, other, _report(aeo=99), url="https://other.example/blog/post")
    assert gm.measure(db, db.get(Business, other))["metrics"]["aeo.score"]["value"] is None


def test_a_failing_live_read_is_a_reason_not_a_crash(client, db, monkeypatch):
    bid = _project(client)
    monkeypatch.setattr(page_xray, "run", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("could not fetch: timeout")))
    d = gm.measure(db, db.get(Business, bid), live=True)
    assert d["metrics"]["aeo.score"]["value"] is None and "could not fetch" in d["metrics"]["aeo.score"]["reason"] and d["areas"]["aeo"]["state"] == "blocked"


def test_a_project_without_a_website(client, db):
    bid = _project(client)
    b = db.get(Business, bid)
    b.website = None
    db.commit()
    d = gm.measure(db, b, live=True)  # live=True still fetches nothing: there is no address
    for k in gm.WEBSITE_KEYS:
        assert d["metrics"][k]["value"] is None and d["metrics"][k]["reason"] == "No website on the project", k
    assert d["areas"]["seo"] == {"score": None, "state": "blocked", "blockers": ["No website on the project"]}
    assert d["metrics"]["seo.onpage_score"]["reason"] == "No website"


# ---------------------------------------------------------------------------------------------------- ChatGPT and presence
def test_chatgpt_is_left_out_of_presence_until_it_is_started_and_weights_are_renormalised(client, db):
    bid = _project(client)
    _store_xray(db, bid, _report(seo=78, aeo=40, geo_=60))
    d = gm.measure(db, db.get(Business, bid))
    c = d["areas"]["chatgpt"]
    assert c["state"] == "not_started" and c["score"] is None and d["metrics"]["chatgpt.claim"]["value"] == 0 and d["metrics"]["chatgpt.catalog_items"]["value"] == 0
    measured = {a: v["score"] for a, v in d["areas"].items() if v["state"] == "measured"}
    assert set(measured) == {"local", "seo", "aeo", "geo"} and "gmb" not in measured  # the Google profile is not linked: blocked, so not counted either
    w = d["weights"]
    assert d["presence"] == round(sum(w[a] * s for a, s in measured.items()) / sum(w[a] for a in measured))
    # start the ChatGPT work: claim pending
    db.add(ChatGPTBusiness(business_id=bid, claim_status="Claim_Pending", business_name="Asha Rentals", category="Rental", description="d", website_url="https://asha.example"))
    db.commit()
    d2 = gm.measure(db, db.get(Business, bid))
    assert d2["areas"]["chatgpt"]["state"] == "measured" and d2["metrics"]["chatgpt.claim"]["value"] == 1
    assert d2["areas"]["chatgpt"]["score"] == d2["metrics"]["chatgpt.readiness"]["value"] == 25  # only the profile item (25%) is done
    measured2 = {a: v["score"] for a, v in d2["areas"].items() if v["state"] == "measured"}
    assert "chatgpt" in measured2 and d2["presence"] == round(sum(w[a] * s for a, s in measured2.items()) / sum(w[a] for a in measured2))
    # a catalog item alone also counts as started; approval and the persona check raise the claim level
    other = _project(client, name="Catalog Co")
    db.add(CatalogItem(business_id=other, sku="S1", title="Lehenga", price=100, currency="INR", availability="in_stock", product_url="https://x.example/s1"))
    db.commit()
    assert gm.measure(db, db.get(Business, other))["areas"]["chatgpt"]["state"] == "measured"
    row = db.query(ChatGPTBusiness).filter(ChatGPTBusiness.business_id == bid).one()
    row.claim_status, row.verification_method, row.persona_verified = "Claim_Approved", "DNS_TXT", True
    db.commit()
    assert gm.measure(db, db.get(Business, bid))["metrics"]["chatgpt.claim"]["value"] == 3
    row.persona_verified, row.claim_status = False, "Disputed"
    db.commit()
    assert gm.measure(db, db.get(Business, bid))["metrics"]["chatgpt.claim"]["value"] == -1


def test_presence_is_null_when_nothing_could_be_measured(client, db, monkeypatch):
    bid = _project(client)
    b = db.get(Business, bid)
    monkeypatch.setattr(gm, "_local", lambda *a: {"score": None, "state": "blocked", "blockers": ["x"]})
    b.website = None
    db.commit()
    d = gm.measure(db, b)
    assert d["presence"] is None and all(v["state"] != "measured" for v in d["areas"].values())


# ---------------------------------------------------------------------------------------------------- snapshots
def test_snapshots_upsert_by_day_and_come_back_in_order(client, db):
    bid = _project(client)
    b = db.get(Business, bid)
    first = gm.measure(db, b)
    s1 = gm.save_snapshot(db, b, first, "daily")
    again = gm.measure(db, b)
    again["presence"] = 77
    s2 = gm.save_snapshot(db, b, again, "manual")
    assert s1.id == s2.id and db.query(GrowthSnapshot).filter(GrowthSnapshot.business_id == bid).count() == 1  # the same day replaces
    assert s2.presence == 77 and s2.source == "manual" and set(s2.areas) == {"gmb", "local", "seo", "aeo", "geo", "chatgpt"} and s2.areas["chatgpt"] is None
    for back, p in ((10, 30), (40, 20), (100, 10)):
        db.add(GrowthSnapshot(business_id=bid, day=date.today() - timedelta(days=back), metrics=first["metrics"], areas={}, presence=p, source="daily"))
    db.commit()
    series = gm.snapshots(db, bid, days=90)
    assert [s.presence for s in series] == [20, 30, 77]  # ascending by day; the 100-day-old one is outside the window
    assert gm.latest_snapshot(db, bid).presence == 77 and gm.latest_snapshot(db, 999999) is None
    assert gm.metric(gm.latest_snapshot(db, bid).metrics, "gmb.profile_score") == first["metrics"]["gmb.profile_score"]["value"]
    assert gm.save_snapshot(db, b, again, "bogus").source == "manual"  # an unknown source never reaches the table
    other = _project(client, name="Other Snap")
    assert gm.snapshots(db, other) == []  # a project never sees another project's series
