"""Growth Plan: realistic targets, capacity, policy rules, idempotent plans, live verification, scoping and the schedule (all offline: measurements are faked)."""
from datetime import date, timedelta

import pytest

from app.db import SessionLocal
from app.models import Business, GrowthAction, GrowthTarget, Schedule
from app.services import growth_metrics, growth_plan as gp

FORBIDDEN = ("buy", "incentiv", "gate", "fake", "duplicate", "stuff", "backlink_buy", "weaken", "disable_security")


def metrics(**over):
    base = {"gmb.reviews_total": 1, "gmb.rating": 5.0, "gmb.reviews_30d": 1, "gmb.reply_rate": 0, "gmb.unanswered": 1, "gmb.photos_total": 2, "gmb.posts_30d": 2, "gmb.profile_score": 56,
            "gmb.verified": 1, "gmb.completeness": 64, "gmb.views_30d": 90, "gmb.calls_30d": 0, "gmb.directions_30d": 47, "gmb.website_clicks_30d": 2, "local.score": 34, "local.citations_verified": 1,
            "local.citations_listed": 1, "local.keywords_tracked": 2, "local.maps_top3": 0, "local.keywords_page1": 0, "chatgpt.readiness": 0, "chatgpt.claim": 0, "chatgpt.catalog_items": 0,
            "seo.onpage_score": 44, "seo.technical_score": 84, "seo.audit_issues": 12, "seo.xray_seo": 78, "seo.security_headers": 0, "seo.ssl_days_left": 50, "aeo.score": 8, "aeo.faq_schema": 0,
            "aeo.direct_answer": 0, "geo.score": 45, "geo.ai_bots_allowed": 7, "geo.llms_txt": 0, "geo.org_schema": 0, "geo.share_of_voice": 25}
    base.update(over)
    units = {}
    out = {k: {"value": v, "unit": units.get(k, ""), "area": k.split(".")[0], "source": "test", "available": v is not None, "reason": None if v is not None else "Not measured in this test"} for k, v in base.items()}
    return {"at": "2026-11-12T00:00:00Z", "metrics": out, "weights": {"gmb": 30, "local": 15, "seo": 20, "aeo": 10, "geo": 15, "chatgpt": 10},
            "areas": {a: {"score": 50, "state": "measured", "blockers": []} for a in ("gmb", "local", "seo", "aeo", "geo")} | {"chatgpt": {"score": None, "state": "not_started", "blockers": ["Not started"]}},
            "presence": 40}


@pytest.fixture
def fake(monkeypatch):
    state = {"data": metrics()}

    def measure(db, b, live=False):
        return state["data"]
    monkeypatch.setattr(growth_metrics, "measure", measure)
    monkeypatch.setattr(gp, "_measure", lambda db, b, live=False: state["data"])
    monkeypatch.setattr(gp, "_homepage_checks", lambda db, b, live: [{"area": "seo", "key": "one_h1", "label": "Exactly one H1", "weight": 8, "detail": "2 H1s", "fix": "", "url": "https://growth.example/"},
                                                                       {"area": "geo", "key": "org_schema", "label": "Org schema", "weight": 10, "detail": "none", "fix": "", "url": "https://growth.example/"}])
    return state


def _project(client, **extra):
    r = client.post("/api/v1/businesses", json={"name": "Growth Co", "city": "Pune", "website": "https://growth.example", **extra})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _spec(metric):
    return gp.SPEC[metric]


# ------------------------------------------------------------------------------------------------------------------- the target math
def test_a_low_metric_is_capped_to_a_realistic_gain_and_says_so():
    t = gp.plan_target(_spec("gmb.profile_score"), 56, "monthly")
    assert t["mode"] == "build" and 56 < t["target"] <= 56 + 8 and t["cap"] and "not be realistic" in t["note"] or "at most" in t["note"].lower()
    w = gp.plan_target(_spec("gmb.profile_score"), 56, "weekly")
    assert 56 < w["target"] < t["target"]  # a week is a part of the month


def test_a_healthy_metric_is_held_not_pushed_and_never_shown_as_an_up_target_below_today():
    t = gp.plan_target(_spec("gmb.profile_score"), 90, "monthly")
    assert t["mode"] == "maintain" and t["direction"] == "keep" and t["target"] <= 90


def test_the_rating_is_never_chased():
    t = gp.plan_target(_spec("gmb.rating"), 4.6, "monthly")
    assert t["direction"] == "keep" and t["target"] <= 4.6 and "real customers" in t["note"]


def test_posts_and_photos_stay_within_what_looks_natural():
    assert 1 <= gp.weekly_posts(0) <= 3 and gp.weekly_posts(40) <= 3 and gp.weekly_posts(None) <= 3
    assert gp.weekly_photos(0) <= 3 and gp.weekly_photos(None) <= 3


def test_unanswered_reviews_go_to_zero_and_cannot_overshoot():
    t = gp.plan_target(_spec("gmb.unanswered"), 5, "monthly")
    assert t["direction"] == "down" and t["target"] >= 0
    assert gp.plan_target(_spec("gmb.unanswered"), 0, "monthly")["mode"] == "maintain"


def test_scale_shrinks_after_misses_and_never_grows_beyond_the_cap():
    small = gp.plan_target(_spec("gmb.profile_score"), 56, "monthly", 0.75)
    big = gp.plan_target(_spec("gmb.profile_score"), 56, "monthly", 1.25)
    assert small["target"] <= big["target"] <= 56 + float(_spec("gmb.profile_score")["cap"](56))


# ------------------------------------------------------------------------------------------------------------------- the plan
def test_refresh_makes_targets_and_actions_once(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        n_t = db.query(GrowthTarget).filter_by(business_id=bid).count()
        n_a = db.query(GrowthAction).filter_by(business_id=bid).count()
        assert n_t > 5 and n_a > 3
        gp.refresh(db, b, "system", live=False)
        db.commit()
        assert db.query(GrowthTarget).filter_by(business_id=bid).count() == n_t and db.query(GrowthAction).filter_by(business_id=bid).count() == n_a  # never duplicated
    finally:
        db.close()


def test_a_fresh_target_is_not_at_risk_on_the_day_it_is_set(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        p = gp.payload(db, b)
        assert all(t["status"] != "at_risk" for per in p["targets"].values() for t in per)
        assert p["mode"] in ("build", "maintain") and set(p["targets"]) == {"daily", "weekly", "monthly"}
    finally:
        db.close()


def test_capacity_follows_the_plan_and_the_rest_is_listed_as_deferred(client, fake):
    bid = _project(client, plan="Starter")
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        p = gp.payload(db, b)
        cap = p["reality"]["capacity"]
        assert cap == {"daily": 2, "weekly": 5, "monthly": 8}
        assert len([a for a in p["actions"]["today"] if a["status"] != "blocked"]) <= cap["daily"]
        assert len([a for a in p["actions"]["week"] if a["status"] != "blocked"]) <= cap["weekly"]
        assert p["reality"]["deferred"]  # more was possible than fits: the rest is named, not dropped silently
    finally:
        db.close()


def test_a_missing_prerequisite_is_a_blocked_task_with_a_way_out_not_a_fake_number(client, fake):
    fake["data"] = metrics(**{"gmb.reviews_total": None, "gmb.rating": None, "gmb.reply_rate": None, "gmb.unanswered": None, "gmb.photos_total": None, "gmb.posts_30d": None,
                              "gmb.profile_score": None, "gmb.completeness": None})
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        blocked = db.query(GrowthTarget).filter_by(business_id=bid, status="blocked").all()
        assert blocked and all(t.target is None and t.baseline is None for t in blocked)  # no invented number
        assert any("Not measured" in (t.feasibility or {}).get("note", "") for t in blocked)
    finally:
        db.close()


def test_the_policy_is_enforced_in_every_task(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        p = gp.payload(db, b)
        acts = [a for k in ("today", "week", "month") for a in p["actions"][k]]
        for a in acts:
            text = (a["key"] + " " + a["title"]).lower()
            assert not any(w in text for w in ("buy ", "incentiv", "gate ", "fake ", "duplicate listing", "weaken", "disable ")), a["title"]
        reviews = [a for a in acts if "review" in a["key"] and "ask" in a["key"]]
        assert reviews and all("real customer" in (a["title"] + " ".join(a["how"]) + a["why"]).lower() for a in reviews)
        assert sum(1 for a in acts if a["key"].startswith("gmb.post")) <= 3
        assert any("real customers" in r for r in p["reality"]["policy"]) and any("security" in r.lower() for r in p["reality"]["policy"])
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- reality checks
def test_the_users_click_never_makes_a_task_verified(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        a = db.query(GrowthAction).filter(GrowthAction.business_id == bid, GrowthAction.status == "todo", GrowthAction.key.like("gmb.reply%")).first()
        assert a is not None
        gp.mark_done(db, b, a, "Tester", "replied")
        assert a.status == "done" and a.verified_at is None  # a click is only a claim
        gp.verify_action(db, b, a, live=False)  # the live number still says 1 review waits
        assert a.status == "unverified" and a.evidence["passed"] is False and a.evidence["details"]
        fake["data"] = metrics(**{"gmb.unanswered": 0})  # the reviews really were answered
        res = gp.verify_action(db, b, a, live=False)
        assert res["passed"] is True and a.status == "verified" and a.verified_at is not None
    finally:
        db.close()


def test_skipping_needs_a_reason_and_a_blocked_task_cannot_be_marked_done(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        a = db.query(GrowthAction).filter(GrowthAction.business_id == bid, GrowthAction.status == "todo").first()
        with pytest.raises(ValueError):
            gp.skip_action(db, b, a, "no", "T")
        gp.skip_action(db, b, a, "Not relevant this week", "T")
        assert a.status == "skipped"
        blocked = GrowthAction(business_id=bid, area="gmb", key="x.blocked", period="daily", due_on=date.today(), title="b", status="blocked", how=[], verify={})
        db.add(blocked)
        db.flush()
        with pytest.raises(ValueError):
            gp.mark_done(db, b, blocked, "T")
    finally:
        db.close()


def test_a_week_that_closes_unmet_is_missed_and_the_next_week_adapts(client, fake):
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        # pretend two earlier weeks closed with every target missed
        for k in (1, 2):
            start = date.today() - timedelta(days=7 * k + date.today().weekday())
            for m in ("gmb.profile_score", "local.score", "seo.onpage_score"):
                db.add(GrowthTarget(business_id=bid, area="gmb", metric=m, label=m, period="weekly", window_start=start, window_end=start + timedelta(days=6), baseline=50, target=55, current=50,
                                    unit="score", direction="up", status="missed", closed_at=None))
        db.flush()
        for t in db.query(GrowthTarget).filter(GrowthTarget.business_id == bid, GrowthTarget.window_end < date.today()):
            t.closed_at = t.created_at
        db.commit()
        scale, note = gp.scale_for(db, b, "weekly", date.today())
        assert scale < 1 and note and "smaller" in note.lower()
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- the API
def test_api_flow_scoping_and_rate_limits(client, fake, monkeypatch):
    from test_security import login, user
    from app.routers import growth_plan as router
    bid = _project(client)
    base = f"/api/v1/businesses/{bid}/growth"
    assert client.post(f"{base}/refresh").status_code == 200
    d = client.get(base).json()
    assert d["presence"]["score"] == 40 and d["reality"]["policy"] and d["actions"]["today"]
    a = next(x for x in d["actions"]["today"] if x["key"].startswith("gmb.reply"))
    ask = next(x for x in d["actions"]["today"] if x["key"].startswith("gmb.ask"))
    client.post(f"{base}/actions/{ask['id']}/done", json={})
    cannot = client.post(f"{base}/actions/{ask['id']}/verify").json()
    assert cannot["action"]["status"] == "done" and cannot["result"]["passed"] is None and cannot["result"]["details"]  # cannot be proven today: it says so, never "verified"
    assert client.post(f"{base}/actions/{a['id']}/skip", json={"reason": "no"}).status_code == 422
    done = client.post(f"{base}/actions/{a['id']}/done", json={"note": "did it"}).json()["action"]
    assert done["status"] == "done"  # done, not verified
    v = client.post(f"{base}/actions/{a['id']}/verify").json()
    assert v["action"]["status"] in ("verified", "unverified") and "details" in v["result"]
    assert client.post(f"{base}/actions/999999/done", json={}).status_code == 404
    assert any(r["business_id"] == bid for r in client.get("/api/v1/growth/overview").json())
    user("gp1@x.in", "editor")
    user("gp2@x.in", "editor")
    one, _ = login("gp1@x.in")
    two, _ = login("gp2@x.in")
    mine = one.post("/api/v1/businesses", json={"name": "Mine Growth"}).json()["id"]
    assert two.get(f"/api/v1/businesses/{mine}/growth").status_code == 404
    assert two.post(f"/api/v1/businesses/{mine}/growth/refresh").status_code == 404
    assert all(r["business_id"] != mine for r in two.get("/api/v1/growth/overview").json())
    router._refresh_limit.hits.clear()
    monkeypatch.setattr(router, "_refresh_limit", gp.RateLimit(1))
    assert client.post(f"{base}/refresh").status_code == 200 and client.post(f"{base}/refresh").status_code == 429


# ------------------------------------------------------------------------------------------------------------------- the schedule and onboarding
def test_the_three_jobs_exist_and_onboarding_survives_a_growth_failure(client, fake, monkeypatch):
    from app.services import schedules, workplan
    assert {"growth_daily", "growth_weekly", "growth_monthly"} <= set(schedules.JOBS)
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        schedules.ensure_jobs(db, b)
        jobs = {s.job: s.every for s in db.query(Schedule).filter_by(business_id=bid)}
        assert jobs.get("growth_daily") == "daily" and jobs.get("growth_weekly") == "weekly" and jobs.get("growth_monthly") == "monthly"
        monkeypatch.setattr(gp, "refresh", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
        monkeypatch.setattr(workplan.audits, "run_all", lambda db, b: [])
        monkeypatch.setattr(workplan.site_research, "run", lambda db, b: type("P", (), {"status": "done"})())
        steps = workplan.start_project(db, b, run_audits=False)
        assert steps["growth"] == "skipped"  # onboarding carried on
    finally:
        db.close()


def test_an_unlinked_google_profile_blocks_its_tasks_and_asks_to_connect_first(client, fake):
    data = metrics(**{"gmb.reviews_total": None, "gmb.unanswered": None})
    data["areas"]["gmb"] = {"score": None, "state": "blocked", "blockers": ["Connect the Google account to measure the profile"]}
    fake["data"] = data
    bid = _project(client)
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        gp.refresh(db, b, "system", live=False)
        db.commit()
        acts = db.query(GrowthAction).filter_by(business_id=bid).all()
        keys = {a.key: a.status for a in acts}
        assert "gmb.connect_google" in keys and keys["gmb.connect_google"] == "todo"
        assert keys.get("gmb.post") == "blocked" and keys.get("gmb.reply_reviews") in (None, "blocked")  # nothing Google-side can be asked before the account is connected
    finally:
        db.close()


def test_every_area_with_an_open_target_gets_work_across_the_month(client, fake):
    bid = _project(client, plan="Growth")
    db = SessionLocal()
    try:
        b = db.get(Business, bid)
        data = fake["data"]
        data["areas"]["chatgpt"] = {"score": None, "state": "not_started", "blockers": ["Not started"]}
        gp.refresh(db, b, "system", live=False)
        db.commit()
        p = gp.payload(db, b)
        areas = {a["area"] for k in p["actions"].values() for a in k}
        assert {"gmb", "local", "seo", "aeo", "geo", "chatgpt"} <= areas, areas
    finally:
        db.close()


def test_a_saved_x_ray_that_found_no_text_is_not_trusted():
    from app.services import growth_metrics as gm
    empty_plain = {"scores": {"seo": {"score": 78}}, "rendering": {"mode": "html"}, "content": {"word_count": 0}}
    real_plain = {"scores": {"seo": {"score": 78}}, "rendering": {"mode": "html"}, "content": {"word_count": 800}}
    rendered = {"scores": {"seo": {"score": 83}}, "rendering": {"mode": "chrome"}, "content": {"word_count": 1553}}
    assert gm.trustworthy_report(empty_plain) is False and gm.trustworthy_report(real_plain) and gm.trustworthy_report(rendered)
    assert gm.trustworthy_report(None) is False and gm.trustworthy_report({"content": {"word_count": 900}}) is False


def test_a_target_set_late_in_the_window_is_not_at_risk_on_the_day_it_is_set_whatever_the_weekday():
    from datetime import datetime, timezone
    friday = date(2026, 11, 13)
    t = GrowthTarget(business_id=1, area="gmb", metric="gmb.profile_score", label="x", period="weekly", window_start=date(2026, 11, 9), window_end=date(2026, 11, 15), baseline=56, target=58, current=56, direction="up", status="open")
    t.created_at = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)
    assert gp.live_status(t, friday) == "on_track"  # three days left, nothing expected yet
    assert gp.live_status(t, date(2026, 11, 15)) == "at_risk"  # by the last day with no progress it is
