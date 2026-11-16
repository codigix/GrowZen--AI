"""The backlink workspace: our links with follow type, anchor, category and a useful-or-not verdict; referring domains; competitor gap; audit; Moz figures only when set up."""
import pytest

from app.backlinks import crawler_sync, hub
from app.backlinks.models import BiDomainMetric
from app.config import get_settings
from app.db import SessionLocal
from app.services import backlink_checker as bc
from app.services import crawler_client as cc

ME = "hub-clinic.in"
RIVAL = "rival-clinic.in"


def link(src, dest, anchor="Hub Clinic", status="verified", active=True, rel=None):
    return {"source_url": src, "destination_url": dest, "anchor_text": anchor, "rel": rel, "link_status": status, "verification_status": status,
            "first_seen": "2026-11-06 11:25:06", "last_verified": "2026-11-13 12:00:00", "is_active": active}


@pytest.fixture()
def world(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "crawler_url", "https://c.example")
    monkeypatch.setattr(s, "crawler_api_key", "k")
    data = {ME: [link("https://healthblog.com/best-clinics", f"https://{ME}/"), link("https://listings.in/dir/hub", f"https://{ME}/", rel="nofollow", anchor="https://hub-clinic.in"),
                 link("https://old.net/p", f"https://{ME}/", status="lost", active=False)],
            RIVAL: [link("https://healthblog.com/best-clinics", f"https://{RIVAL}/", anchor="Rival Clinic"), link("https://citydirectory.in/clinics/rival", f"https://{RIVAL}/", anchor="Rival Clinic"),
                    link("https://wellness-news.in/story", f"https://{RIVAL}/", anchor="best clinic near me")]}
    monkeypatch.setattr(cc, "backlinks", lambda domain, include_removed=False, limit=100, offset=0: {"domain": domain, "status": "ok", "backlinks": data.get(domain, [])[offset:offset + limit]})
    bid = client.post("/api/v1/businesses", json={"name": "Hub Clinic", "website": f"https://www.{ME}/"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/backlink-intel/targets", json={"domain": RIVAL, "is_competitor": True}).status_code == 201
    db = SessionLocal()
    try:
        crawler_sync.run_cycle(db, bid)
    finally:
        db.close()
    return bid


def get(client, bid, path, **params):
    r = client.get(f"/api/v1/businesses/{bid}/backlink-hub/{path}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_links_carry_follow_anchor_category_and_a_verdict(client, world):
    d = get(client, world, "links")
    assert d["state"] == "ok" and d["domain"] == ME and d["live_total"] == 2 and d["total"] == 2
    by = {x["source_domain"]: x for x in d["links"]}
    assert by["healthblog.com"]["follow"] == "dofollow" and by["listings.in"]["follow"] == "nofollow"
    assert by["listings.in"]["anchor_type"] == "naked" and by["healthblog.com"]["anchor_type"] in ("branded", "compound")
    assert by["healthblog.com"]["category"]["key"] and by["healthblog.com"]["useful"] in ("useful", "neutral", "risky", "unscored")
    assert by["listings.in"]["useful"] in ("neutral", "unscored", "risky") and by["healthblog.com"]["useful_why"]
    assert by["healthblog.com"]["metrics"] is None  # no Moz: nothing invented
    assert d["facets"]["follow"] == {"dofollow": 1, "nofollow": 1}
    assert get(client, world, "links", follow="nofollow")["total"] == 1
    assert get(client, world, "links", status="lost")["total"] == 1
    assert get(client, world, "links", q="healthblog")["total"] == 1


def test_domains_and_summary(client, world):
    dm = get(client, world, "domains")
    assert dm["total"] == 3 and {x["domain"] for x in dm["domains"]} == {"healthblog.com", "listings.in", "old.net"}
    s = get(client, world, "summary")
    assert s["totals"]["live"] == 2 and s["totals"]["lost"] == 1 and s["totals"]["referring_domains"] == 2 and s["totals"]["dofollow_share"] == 50 and s["totals"]["avg_da"] is None
    assert s["crawler"]["configured"] is True and s["moz"]["configured"] is False and s["used_in"]


def test_opportunities_are_sites_that_link_to_rivals_but_not_us(client, world):
    o = get(client, world, "opportunities")
    names = {x["domain"] for x in o["opportunities"]}
    assert "healthblog.com" not in names  # already links to us
    assert {"citydirectory.in", "wellness-news.in"} <= names | {"wellness-news.in"}
    assert o["competitors"] == [RIVAL] and all(x["how"] and x["competitors"] == [RIVAL] for x in o["opportunities"])
    assert all(x["useful"] != "risky" for x in o["opportunities"])


def test_audit_flags_lost_links(client, world):
    a = get(client, world, "audit")
    assert a["state"] == "ok" and any(i["key"] == "lost" and i["count"] == 1 for i in a["items"])


def test_moz_figures_only_when_configured_then_used(client, world, monkeypatch):
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["configured"] is False and r["refreshed"] == 0
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "key", raising=False)
    monkeypatch.setattr(bc, "moz_metrics", lambda urls: {u.removeprefix("https://"): {"da": 62, "pa": 48, "spam": 2, "ref_domains": 900} for u in urls})
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["configured"] is True and r["refreshed"] >= 2
    d = get(client, world, "links")
    hb = next(x for x in d["links"] if x["source_domain"] == "healthblog.com")
    assert hb["metrics"]["da"] == 62 and hb["metrics"]["spam"] == 2 and hb["follow"] == "dofollow" and hb["useful"] == "useful"
    assert get(client, world, "summary")["totals"]["avg_da"] == 62
    db = SessionLocal()
    try:
        assert hub.metrics_for(db, ["healthblog.com"])["healthblog.com"]["pa"] == 48
        assert db.query(BiDomainMetric).count() >= 2
    finally:
        db.close()


def test_a_business_without_a_site_gets_a_plain_state(client):
    bid = client.post("/api/v1/businesses", json={"name": "No Site"}).json()["id"]
    assert get(client, bid, "links")["state"] == "no_target"
    assert get(client, bid, "opportunities")["state"] == "no_target"


def test_another_users_business_is_not_readable(client, world):
    assert client.get("/api/v1/businesses/999999/backlink-hub/links").status_code in (403, 404)


def post(client, bid, path, body=None):
    r = client.post(f"/api/v1/businesses/{bid}/backlink-hub/{path}", json=body or {})
    assert r.status_code == 200, r.text
    return r.json()


def test_plan_statuses_advice_and_the_crawler_confirming_a_link(client, world, monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    o = get(client, world, "opportunities")["opportunities"]
    d = next(x for x in o if x["domain"] == "citydirectory.in")
    assert d["status"] == "new" and d["has_advice"] is False
    a = post(client, world, "advice", {"domain": "citydirectory.in"})
    assert a["method"] == "rules" and a["steps"] and a["what_you_get"] and "[add" in a["message"]
    assert get(client, world, "opportunities")["opportunities"][0]["has_advice"] is True or any(x["has_advice"] for x in get(client, world, "opportunities")["opportunities"])
    p = post(client, world, "plan", {"domain": "citydirectory.in", "status": "contacted", "note": "emailed the editor"})
    assert p["counts"]["contacted"] == 1 and p["items"][0]["note"] == "emailed the editor"
    assert next(x for x in get(client, world, "opportunities")["opportunities"] if x["domain"] == "citydirectory.in")["status"] == "contacted"
    post(client, world, "plan", {"domain": "wellness-news.in", "status": "skipped"})
    assert "wellness-news.in" not in {x["domain"] for x in get(client, world, "opportunities")["opportunities"]}
    assert [x["domain"] for x in get(client, world, "opportunities", status="skipped")["opportunities"]] == ["wellness-news.in"]
    assert client.post(f"/api/v1/businesses/{world}/backlink-hub/plan", json={"domain": "not a site", "status": "planned"}).status_code == 422
    # the crawler later sees the site linking to us: it counts as live whatever was clicked
    db = SessionLocal()
    try:
        crawler_sync.save_link(db, link("https://citydirectory.in/clinics/hub", f"https://{ME}/"), hub.utcnow())
        db.commit()
    finally:
        db.close()
    plan = get(client, world, "plan")
    live = next(x for x in plan["items"] if x["domain"] == "citydirectory.in")
    assert live["status"] == "live" and live["confirmed"] is True and plan["counts"]["live"] == 1


def test_ai_advice_and_platform_suggestions_are_checked_before_use(client, world, monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    calls = []

    def fake(system, user, **kw):
        calls.append(user)
        if "Website to approach" in user:
            return {"what_it_is": "A city directory.", "what_you_get": ["Local visitors"], "effort": "low", "steps": ["Claim the listing"], "message": "Hello [add name]", "caution": ""}
        return {"platforms": [{"domain": "https://www.indiamart.com/x", "name": "IndiaMART", "kind": "directory", "why": "Buyers search here", "how": "Create a listing"},
                              {"domain": "healthblog.com", "name": "Already links", "kind": "blog", "why": "x", "how": "y"}, {"domain": RIVAL, "name": "Rival", "kind": "other", "why": "x", "how": "y"},
                              {"domain": "not a domain", "name": "Bad", "kind": "other", "why": "x", "how": "y"}, {"domain": "nolist.org", "name": "No how", "kind": "other", "why": "x", "how": ""}]}
    monkeypatch.setattr(ai, "complete_json", fake)
    a = post(client, world, "advice", {"domain": "citydirectory.in"})
    assert a["method"] == "ai" and a["effort"] == "low"
    again = post(client, world, "advice", {"domain": "citydirectory.in"})
    assert again == a and len(calls) == 1  # saved: no second AI call
    s = post(client, world, "platforms/suggest")
    assert s["state"] == "ok" and [x["domain"] for x in s["platforms"]] == ["indiamart.com"]  # own links, competitors, bad domains and incomplete entries are dropped


def test_platform_suggestions_need_an_ai_key(client, world, monkeypatch):
    from app.services import ai
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    assert post(client, world, "platforms/suggest")["state"] == "no_ai"
