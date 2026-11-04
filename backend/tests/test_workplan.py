"""Website research, the weekly work plan, carry-over, verification and the weekly/monthly reports. No network: the crawl is canned."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app import models
from app.db import SessionLocal
from app.services import crawler, site_research, workplan

HOME = """<html lang="en"><head><title>Acme</title><link rel="icon" href="/f.ico"><meta name="viewport" content="width=device-width">
<meta property="og:title" content="Acme"></head><body><h1>Acme dental</h1><p>short</p></body></html>"""
GOOD = """<html lang="en"><head><title>Teeth whitening in Pune | Acme Dental Clinic</title>
<meta name="description" content="Safe, quick teeth whitening in Pune by Acme Dental Clinic. Book your visit today and leave with a brighter smile you will love.">
<link rel="canonical" href="https://acme.example/whitening"><meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:image" content="https://a/i.jpg">
<meta name="twitter:card" content="summary"><script type="application/ld+json">{"@type":"Service"}</script></head><body><h1>Teeth whitening</h1></body></html>"""


@pytest.fixture()
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture()
def biz(db, monkeypatch):
    b = models.Business(name="Acme Dental", website="https://acme.example", city="Pune", primary_category="Dentist", plan="Growth",
                        services=[{"name": "Teeth whitening"}, {"name": "Root canal"}], target_areas=["Aundh, Pune"], faqs=[{"q": "a", "a": "b"}])
    db.add(b)
    db.commit()
    pages = [crawler.analyse_html("https://acme.example/", 200, HOME), crawler.analyse_html("https://acme.example/whitening", 200, GOOD)]
    monkeypatch.setattr(site_research.audits.crawler, "crawl", lambda url, max_pages=25, timeout=15, on_progress=None: {
        "start_url": url, "host": "acme.example", "https": True, "robots_txt": True, "robots_blocks_all": False, "sitemap": False, "crawled": 2, "broken": [], "pages": pages})
    monkeypatch.setattr(site_research, "site_checks", lambda url, crawl: {"https": True, "robots_txt": True, "sitemap": False, "llms_txt": False, "reachable": True,
                                                                          "security_headers": {"strict-transport-security": False, "x-content-type-options": False, "referrer-policy": False,
                                                                                               "content-security-policy": False}, "compression": None})
    monkeypatch.setattr(site_research.site_onboarding, "detect_and_store", lambda db, b: {
        "platform": "wordpress", "label": "WordPress", "version": "6.4", "reachable": True, "stack": ["WordPress 6.4", "PHP"], "details": {"plugins": ["Elementor"], "analytics": []}})
    yield b


def keys(prof):
    return {r["key"] for r in prof.recommendations}


def test_metadata_audit_flags_what_is_missing_and_computes_coverage():
    pages = [crawler.analyse_html("https://a/", 200, HOME), crawler.analyse_html("https://a/w", 200, GOOD)]
    m = site_research.metadata_audit(pages)
    home = next(r for r in m["pages"] if r["url"] == "https://a/")
    assert {"title_length", "missing_description", "missing_canonical", "incomplete_open_graph", "missing_twitter_card", "missing_schema"} <= set(home["flags"])
    assert m["coverage"]["canonical"] == 50 and m["coverage"]["twitter_card"] == 50 and m["pages_checked"] == 2 and m["has_favicon"] is True


def test_suggested_metadata_stays_within_limits_and_uses_only_profile_facts(biz):
    pages = [crawler.analyse_html("https://acme.example/", 200, HOME)]
    sug = site_research.suggest_metadata(site_research.metadata_audit(pages), biz)
    assert sug and len(sug[0]["title"]) <= 60 and len(sug[0]["description"]) <= 160
    assert "Acme Dental" in sug[0]["title"] and "Pune" in sug[0]["title"] and sug[0]["wording"] == "template"


def test_research_reads_stack_metadata_and_gives_stack_specific_improvements(db, biz):
    prof = site_research.run(db, biz)
    assert prof.status == "done" and prof.stack["platform"] == "wordpress" and prof.metadata_audit["pages_checked"] == 2
    k = keys(prof)
    assert {"rec:wp-seo-plugin", "rec:wp-cache", "rec:wp-builder-weight", "rec:analytics", "rec:sitemap", "rec:open-graph", "rec:meta-descriptions", "rec:security-headers", "rec:llms-txt"} <= k
    assert "rec:service-pages" in k  # "Root canal" has no page; "Teeth whitening" has one
    sp = next(r for r in prof.recommendations if r["key"] == "rec:service-pages")
    assert sp["topics"] == ["Root canal"]
    assert "rec:area-pages" in k and "rec:schema-faq" in k and "rec:schema-local" in k
    assert prof.suggested_metadata and prof.summary.startswith("WordPress 6.4 site")


def test_a_project_without_a_website_still_gets_a_profile(db):
    b = models.Business(name="No site", plan="Starter")
    db.add(b)
    db.commit()
    prof = site_research.run(db, b)
    assert prof.status == "done" and keys(prof) == {"rec:website"}


def test_first_week_plan_has_operations_improvements_capacity_and_backlog(db, biz):
    from app.services import schedules
    schedules.create_for_plan(db, biz)
    site_research.run(db, biz)
    stats = workplan.generate_week(db, biz)
    items = workplan.week_items(db, biz, workplan.week_start())
    ops = [i for i in items if i.source == "operation"]
    committed = [i for i in items if i.source != "operation" and i.status == "todo"]
    assert {o.detail["operation"] for o in ops} >= {"gbp-post", "reviews", "content", "backlinks"}
    assert len(committed) == workplan.CAPACITY["Growth"] and stats["backlog"] > 0
    assert all(c.priority <= 3 for c in committed)  # the most important work is picked first
    again = workplan.generate_week(db, biz)  # idempotent
    assert again["added"] == 0 and len(workplan.week_items(db, biz, workplan.week_start())) == len(items)


def test_unfinished_work_carries_over_and_finished_work_does_not(db, biz):
    site_research.run(db, biz)
    last = workplan.week_start() - timedelta(days=7)
    workplan.generate_week(db, biz, last)
    items = workplan.week_items(db, biz, last)
    imp = [i for i in items if i.source == "research"]
    done, left = imp[0], imp[1]
    workplan.update_item(db, done, {"status": "done", "note": "Plugin installed"}, "tester")
    workplan.update_item(db, left, {"status": "doing"}, "tester")
    stats = workplan.generate_week(db, biz)
    assert stats["carried"] >= 1
    db.refresh(left)
    assert left.status == "carried"
    now = {i.key: i for i in workplan.week_items(db, biz, workplan.week_start())}
    assert now[left.key].carried_from == left.id and now[left.key].carry_count == 1 and now[left.key].status == "todo"
    assert done.key not in now  # done last week, not planned again


def test_an_item_the_research_no_longer_reports_closes_as_verified(db, biz, monkeypatch):
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    it = next(i for i in workplan.week_items(db, biz, workplan.week_start()) if i.key == "rec:wp-seo-plugin")
    assert it.status in ("todo", "backlog")
    monkeypatch.setattr(site_research.site_onboarding, "detect_and_store", lambda db, b: {
        "platform": "wordpress", "label": "WordPress", "reachable": True, "stack": [], "details": {"plugins": ["Yoast SEO", "Elementor"], "analytics": ["Google Analytics"]}})
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    db.refresh(it)
    assert it.status == "done" and it.verified is True


def test_a_skipped_item_does_not_come_back(db, biz):
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    it = next(i for i in workplan.week_items(db, biz, workplan.week_start()) if i.source == "research" and i.status == "todo")
    workplan.update_item(db, it, {"status": "skipped", "note": "Client declined"}, "tester")
    workplan.generate_week(db, biz, workplan.week_start() + timedelta(days=7))
    assert not [i for i in db.query(models.WorkItem).filter_by(business_id=biz.id, key=it.key) if i.status in ("todo", "backlog")]


def test_weekly_report_compares_with_last_week_and_lists_future_scope(db, biz):
    site_research.run(db, biz)
    wk = workplan.week_start()
    workplan.generate_week(db, biz, wk - timedelta(days=7))
    for i in workplan.week_items(db, biz, wk - timedelta(days=7))[:3]:
        workplan.update_item(db, i, {"status": "done"}, "tester")
    workplan.generate_week(db, biz, wk)
    cur = next(i for i in workplan.week_items(db, biz, wk) if i.status == "todo")
    workplan.update_item(db, cur, {"status": "done", "note": "Fixed"}, "tester")
    r = workplan.build_report(db, biz, "week", wk)
    assert r["previous"]["done"] == 3 and r["previous"]["planned"] >= 3 and r["this_period"]["done"] >= 1
    assert any(c["title"] == cur.title for c in r["this_period"]["completed"])
    assert r["future_scope"] and r["highlights"] and r["narrative"]
    assert r["changes"]["metadata"]["coverage"] is not None
    assert workplan.build_report(db, biz, "week", wk - timedelta(days=7))["final"] is True  # a finished week is kept as it was


def test_monthly_report_rolls_the_weeks_up(db, biz):
    site_research.run(db, biz)
    wk = workplan.week_start()
    workplan.weekly_cycle(db, biz)
    m = workplan.build_report(db, biz, "month", wk.replace(day=1))
    assert m["period"] == "month" and m["label"] == wk.strftime("%B %Y") and "weeks" in m


def test_api_flow_from_onboarding_to_report(client, monkeypatch):
    monkeypatch.setattr(site_research.site_onboarding, "detect_and_store", lambda db, b: {"platform": "wix", "label": "Wix", "reachable": True, "stack": ["Wix"], "details": {}})
    monkeypatch.setattr(site_research, "site_checks", lambda url, crawl: {"https": True, "reachable": True, "security_headers": {}, "robots_txt": True, "sitemap": True, "llms_txt": True, "compression": "br"})
    bid = client.post("/api/v1/businesses", json={"name": "Flow Co", "website": "https://flow.example", "plan": "Pro"}).json()["id"]
    assert client.post(f"/api/v1/businesses/{bid}/research").status_code == 202  # the background task runs before the response returns in TestClient
    prof = client.get(f"/api/v1/businesses/{bid}/research").json()
    assert prof["status"] == "done" and prof["stack"]["platform"] == "wix" and prof["recommendations"]
    plan = client.get(f"/api/v1/businesses/{bid}/workplan").json()
    assert plan["items"] and plan["progress"]["planned"] > 0
    first = plan["items"][0]
    r = client.patch(f"/api/v1/businesses/{bid}/workplan/items/{first['id']}", json={"status": "done", "note": "Done by test"})
    assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["completed_at"]
    mine = client.post(f"/api/v1/businesses/{bid}/workplan/items", json={"title": "Call the owner about photos", "area": "gmb"})
    assert mine.status_code == 201
    assert client.delete(f"/api/v1/businesses/{bid}/workplan/items/{mine.json()['id']}").status_code == 204
    assert client.delete(f"/api/v1/businesses/{bid}/workplan/items/{first['id']}").status_code == 400  # generated work is skipped, not deleted
    rep = client.get(f"/api/v1/businesses/{bid}/reports/week").json()
    assert rep["this_period"]["done"] == 1 and "future_scope" in rep
    assert client.get(f"/api/v1/businesses/{bid}/reports/week/pdf").content[:4] == b"%PDF"
    assert client.get(f"/api/v1/businesses/{bid}/reports/history").json()
    assert client.get("/api/v1/workplan/overview").json()["projects"]
    sched = {s["job"] for s in client.get(f"/api/v1/businesses/{bid}/schedules").json()}
    assert {"weekly_plan", "site_research"} <= sched


def test_every_task_has_description_test_links_due_date_and_priority(db, biz):
    from app.services import schedules, task_detail
    schedules.create_for_plan(db, biz)
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    wk = workplan.week_start()
    items = workplan.week_items(db, biz, wk)
    assert items
    for i in items:
        d = i.detail
        assert d["description"].startswith("Problem:") and "Done when" in d["description"], i.title
        assert d["priority_label"].startswith("P") and i.status in ("todo", "backlog")
        assert i.due_date and wk <= i.due_date <= wk + timedelta(days=6) or i.due_date >= date.today(), i.title
        assert d["test_links"] and d["test_links"][0]["url"].startswith("https://"), i.title
    og = next(i for i in items if i.key == "rec:open-graph")
    assert any("developers.facebook.com" in l["url"] for l in og.detail["test_links"])
    sitemap = next(i for i in items if i.key == "rec:sitemap")
    assert any(l["url"].endswith("/sitemap.xml") for l in sitemap.detail["test_links"])
    # critical work is due before low-priority work
    assert task_detail.due_for(date(2026, 11, 2), 1, today=date(2026, 10, 1)) < task_detail.due_for(date(2026, 11, 2), 4, today=date(2026, 10, 1))
    # in the current week a date that already passed becomes today
    assert task_detail.due_for(date(2026, 11, 2), 1, today=date(2026, 11, 6)) == date(2026, 11, 6)


def test_tasks_say_where_to_fix_it_on_the_sites_platform_with_a_filled_in_example(db, biz):
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    items = {i.key: i for i in workplan.week_items(db, biz, workplan.week_start())}
    og = items["rec:open-graph"].detail["fix_help"]
    assert og["platform"] == "wordpress" and og["where"][0] == "WP Admin" and "Social tab" in " ".join(og["where"])
    code = og["example"]["code"]
    assert 'og:title" content="Acme Dental | Dentist in Pune"' in code and "Teeth whitening" in code
    sm = items["rec:sitemap"].detail["fix_help"]
    assert "Yoast SEO" in " ".join(sm["where"]) and "Sitemap: https://acme.example/sitemap.xml" in sm["example"]["code"]
    for i in items.values():
        if i.source != "operation":
            assert i.detail["fix_help"]["where"], i.title


def test_ranking_checklist_raises_website_gmb_and_listing_points_with_navigation(db, biz):
    from app.services import ranking_checklist as rc
    biz.gbp_location, biz.logo = "locations/1", None
    biz.gbp_status = {"review_url": "https://g.page/r/abc/review", "maps_url": "https://maps.google.com/?cid=1"}
    db.add(models.Review(business_id=biz.id, rating=2, reply_status="none", author="A"))
    db.commit()
    site_research.run(db, biz)
    workplan.generate_week(db, biz)
    every = {i.key: i for i in db.query(models.WorkItem).filter_by(business_id=biz.id)}
    for k in ("chk:gmb-reply-reviews", "chk:gmb-review-requests", "chk:gmb-logo-cover", "chk:web-about", "chk:web-contact", "chk:off-bing-places", "chk:off-facebook", "chk:web-search-console"):
        assert k in every, k
    rev = every["chk:gmb-review-requests"].detail
    assert rev["fix_help"]["where"][0] == "Business Profile manager" and "g.page/r/abc/review" in rev["fix_help"]["example"]["code"]
    assert any("wa.me" in l["url"] for l in rev["test_links"]) and every["chk:gmb-review-requests"].due_date
    # a data-based point closes itself once the data shows it is fixed; a standing point stays done
    ctx = workplan._checklist_context(db, biz)
    assert "chk:gmb-reply-reviews" not in {"chk:" + p["key"] for p in rc.candidates(dict(ctx, unreplied=0))}
    assert "chk:gmb-reply-reviews" in rc.resolved(dict(ctx, unreplied=0))
    fb = every["chk:off-facebook"]
    workplan.update_item(db, fb, {"status": "done"}, "tester")
    workplan.generate_week(db, biz, workplan.week_start() + timedelta(days=14))
    assert [i for i in db.query(models.WorkItem).filter_by(business_id=biz.id, key="chk:off-facebook") if i.status in ("todo", "backlog")] == []
