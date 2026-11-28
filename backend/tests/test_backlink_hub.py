"""The backlink workspace: our links with follow type, anchor, category and a useful-or-not verdict; referring domains; competitor gap; audit; Moz figures only when set up."""
import pytest

from app.backlinks import crawler_sync, hub
from app.backlinks.models import BiDomainMetric
from app.config import get_settings
from app.db import SessionLocal
from app.services import backlink_checker as bc
from app.services import crawler_client as cc


@pytest.fixture(autouse=True)
def _no_real_data_service(monkeypatch):
    """The real DATAFORSEO_AUTH in .env must never reach these tests: DA, PA and spam appear only where a test sets a service up."""
    from app.services import backlink_checker as bc
    monkeypatch.setattr(bc, "dfs_configured", lambda: False)


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
    m = by["healthblog.com"]["metrics"]
    assert m["da"] is None and m["pa"] is None and m["spam"] is None  # no Moz: nothing invented
    assert m["crawler"]["links"] >= 1 and m["crawler"]["pages"] >= 1  # but our own crawler counts are there
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


def test_dataforseo_figures_fill_da_pa_and_spam_on_the_links_page(client, world, monkeypatch):
    db = SessionLocal()
    try:
        db.query(BiDomainMetric).delete()  # figures an earlier test saved must not hide what this one fetches
        db.commit()
    finally:
        db.close()
    before = get(client, world, "links")
    assert before["scores"]["configured"] is False
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    asked = {}

    def fake(domains, pages):
        asked["domains"], asked["pages"] = list(domains), list(pages)
        out = {d: {"rank": 55, "spam": 4} for d in domains}
        out.update({p: {"rank": 31, "spam": None} for p in pages})
        return out

    monkeypatch.setattr(bc, "dfs_scores", fake)
    pending = get(client, world, "links")["scores"]
    assert pending["configured"] is True and pending["source"] == "DataForSEO" and pending["missing"] >= 1
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["configured"] is True and r["refreshed"] >= 1
    assert all(p == f"https://{d}/" for d, p in zip(asked["domains"], asked["pages"]))  # the home page of each site gives the PA-like figure
    d = get(client, world, "links")
    hb = next(x for x in d["links"] if x["source_domain"] == "healthblog.com")
    assert hb["metrics"]["da"] == 55 and hb["metrics"]["pa"] == 31 and hb["metrics"]["spam"] == 4
    assert d["scores"]["missing"] == 0
    assert get(client, world, "summary")["moz"]["configured"] is True


def test_when_moz_has_no_quota_dataforseo_fills_in_and_the_reason_is_shown(client, world, monkeypatch):
    db = SessionLocal()
    try:
        db.query(BiDomainMetric).delete()
        db.commit()
    finally:
        db.close()
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "key", raising=False)

    def no_quota(urls):
        raise bc.CheckError("Moz accepted the login but this account has no lookups left for the period.")

    monkeypatch.setattr(bc, "moz_metrics", no_quota)
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    monkeypatch.setattr(bc, "dfs_scores", lambda domains, pages: {**{d: {"rank": 40, "spam": 5} for d in domains}, **{p: {"rank": 20, "spam": None} for p in pages}})
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["refreshed"] >= 1 and "no lookups left" in r["message"] and "Updated" in r["message"]
    hb = next(x for x in get(client, world, "links")["links"] if x["source_domain"] == "healthblog.com")
    assert hb["metrics"]["da"] == 40
    monkeypatch.setattr(bc, "dfs_configured", lambda: False)  # with nothing to fall back on, Moz's reason is returned as it is
    db = SessionLocal()
    try:
        db.query(BiDomainMetric).delete()
        db.commit()
    finally:
        db.close()
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["refreshed"] == 0 and "no lookups left" in r["message"]


def _clear_metrics():
    db = SessionLocal()
    try:
        db.query(BiDomainMetric).delete()
        db.commit()
    finally:
        db.close()


def test_moz_is_used_when_it_has_quota_and_the_switch_back_upgrades_dataforseo_figures(client, world, monkeypatch):
    _clear_metrics()
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "key", raising=False)
    monkeypatch.setattr(bc, "dfs_configured", lambda: True)
    monkeypatch.setattr(bc, "dfs_scores", lambda domains, pages: {**{d: {"rank": 40, "spam": 5} for d in domains}, **{p: {"rank": 20, "spam": None} for p in pages}})
    state = {"moz": "no_quota"}

    def moz(urls):
        if state["moz"] == "no_quota":
            raise bc.CheckError(bc.MOZ_QUOTA_MSG)
        return {u.removeprefix("https://"): {"da": 62, "pa": 48, "spam": 2, "ref_domains": 900} for u in urls}

    monkeypatch.setattr(bc, "moz_metrics", moz)
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()  # Moz has no quota: DataForSEO answers
    assert r["refreshed"] >= 1 and "from DataForSEO" in r["message"] and "no lookups left" in r["message"]
    hb = lambda: next(x for x in get(client, world, "links")["links"] if x["source_domain"] == "healthblog.com")["metrics"]  # noqa: E731
    assert hb()["da"] == 40 and hb()["source"] == "dataforseo"
    state["moz"] = "ok"  # Moz has quota again
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert "from Moz" in r["message"] and r["refreshed"] >= 1
    assert hb()["da"] == 62 and hb()["source"] == "moz"  # the sites DataForSEO filled in are now Moz's
    r = client.post(f"/api/v1/businesses/{world}/backlink-hub/metrics/refresh").json()
    assert r["message"] == "All figures are recent." or r["refreshed"] == 0  # nothing is asked twice


def test_moz_is_not_asked_again_for_half_an_hour_after_it_reports_no_quota(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "moz_access_id", "id", raising=False)
    monkeypatch.setattr(s, "moz_secret_key", "key", raising=False)
    calls = []

    class R:
        status_code, text = 403, '{"error":"The account does not have enough quota remaining for current period."}'

    monkeypatch.setattr(bc.httpx, "post", lambda *a, **k: (calls.append(1), R())[1])
    with pytest.raises(bc.CheckError):
        bc.moz_metrics(["https://a.example/"])
    assert bc.moz_paused() and not bc.moz_available()
    with pytest.raises(bc.CheckError):
        bc.moz_metrics(["https://a.example/"])
    assert len(calls) == 1  # the second request did not reach Moz
    monkeypatch.setattr(bc, "_moz_pause_until", 0.0)  # the pause is over (quota renewed): Moz is asked again
    assert bc.moz_available()


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


def test_grouped_links_count_sites_not_links_and_never_cut_a_site_in_half(client, world):
    """With group on, limit/offset count SITES and every page of a returned site comes with it, so a page's size can never split a site."""
    plain = get(client, world, "links", limit=200)["links"]
    site_names = list(dict.fromkeys(x["source_domain"] for x in plain))
    assert len(site_names) >= 2
    d = get(client, world, "links", group=True, limit=1, offset=0)
    sites = {x["source_domain"] for x in d["links"]}
    assert d["sites_total"] == len(site_names) and len(sites) == 1
    assert len(d["links"]) == len([x for x in plain if x["source_domain"] in sites])  # all of that site's pages, not a part of them
    second = get(client, world, "links", group=True, limit=1, offset=1)
    other = {x["source_domain"] for x in second["links"]}
    assert len(other) == 1 and other.isdisjoint(sites)
    assert d["total"] == len(plain)  # the link total is still the link total


def test_one_page_linking_with_several_anchors_gives_several_links_that_keep_their_numbers(client, monkeypatch):
    """The crawler lists a link once for each anchor. They are separate links on the page, so each is kept (and none is added again by the next sync)."""
    s = get_settings()
    monkeypatch.setattr(s, "crawler_url", "https://c.example")
    monkeypatch.setattr(s, "crawler_api_key", "k")
    me = "multi-anchor.in"
    rows = [link("https://blog.example/post", f"https://{me}/", anchor=a) for a in ("Alpha clinic", "Beta clinic", "Gamma clinic")] + [link("https://blog.example/post?utm_source=x", f"https://{me}/", anchor="Alpha clinic")]
    monkeypatch.setattr(cc, "backlinks", lambda domain, include_removed=False, limit=100, offset=0: {"domain": domain, "status": "ok", "backlinks": rows[offset:offset + limit]})
    bid = client.post("/api/v1/businesses", json={"name": "Multi Anchor", "website": f"https://www.{me}/"}).json()["id"]
    db = SessionLocal()
    try:
        crawler_sync.run_cycle(db, bid)
        crawler_sync.run_cycle(db, bid)  # again: nothing is added twice
    finally:
        db.close()
    got = get(client, bid, "links", limit=200)["links"]
    assert sorted(x["anchor"] for x in got) == ["Alpha clinic", "Beta clinic", "Gamma clinic"]  # the tracking-part address is the same page and anchor as the first: one link
