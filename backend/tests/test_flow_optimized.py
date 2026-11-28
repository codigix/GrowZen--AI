"""The project journey (services/flow.evaluate) after the query optimisation: the same answer as before, far fewer statements, no large JSON read for a small fact,
scoped to the user's projects, and the shared functions it now calls with optional parameters behave as before for every other caller.

`flow_reference.py` is a frozen copy of the evaluate() that existed before the optimisation."""
import json
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.competitors import hygiene
from app.db import SessionLocal, engine
from app.main import app
from app.models import (AgentTask, AppUser, Article, Audit, BacklinkCheck, Business, Competitor, GrowthAction, GrowthReport, Keyword, Post, Review)
from app.routers import auth as auth_router
from app.routers import flow as flow_router
from app.services import flow, keyword_mapping, keywords as kwsvc, site_guard
from app.services.passwords import hash_password

import flow_reference

NOW = datetime.now(timezone.utc)
PAGES = [
    {"url": "https://shop.example/", "status": 200, "title": "Shop home", "meta_description": "Cakes in Pune", "h1": "Custom cakes", "top_keywords": [{"keyword": "custom cakes"}]},
    {"url": "https://shop.example/catering", "status": 200, "title": "Catering", "meta_description": "Party catering", "h1": "Catering in Pune", "top_keywords": []},
    {"url": "https://shop.example/about", "status": 200, "title": "About", "meta_description": "", "h1": "About us", "top_keywords": []},
]


def _json(x):
    return json.loads(json.dumps(x, default=str, sort_keys=True))


def _audit(db, bid, **kw):
    when = kw.pop("when", NOW)
    db.add(Audit(business_id=bid, kind=kw.pop("kind", "onpage"), status=kw.pop("status", "done"), score=kw.pop("score", 70), created_at=when, finished_at=when, **kw))


def build(db, name, *, modules=None, website="https://shop.example", keywords=0, grouped=0, primaries=0, crawl="live", competitors=(), fixes=(), posts=0, reviews=0,
          review_count=None, checks=(), report=None, articles=0, tasks=(), owner_id=None, extra_audits=()):
    """One project with the rows the journey reads. `crawl`: live | sample | both (a newer sample audit over an older live one) | none."""
    b = Business(name=name, primary_category="Bakery", city="Pune", phone="+91 90000 00000", website=website, status="active", owner_id=owner_id, modules=modules,
                 services=[{"name": "Cakes"}], goals=["More calls"], review_count=review_count, photo_count=3)
    db.add(b)
    db.commit()
    bid = b.id
    for i in range(keywords):
        db.add(Keyword(business_id=bid, keyword=f"custom cakes {i}" if i % 2 else f"catering {i}", volume=100 - i, tracked=True, cluster="Topic" if i < grouped else None,
                       target_url="https://shop.example/" if i < grouped else None, role="primary" if i < primaries else None, uses=["blog"] if i % 3 == 0 else None, rank=i or None,
                       rank_checked_at=date.today() if i % 4 == 0 else None))
    db.add(Keyword(business_id=bid, keyword="not tracked one", tracked=False, role="primary"))  # untracked: counted as a primary keyword, but not a tracked one
    if crawl in ("live", "both"):
        _audit(db, bid, result={"pages": PAGES}, when=NOW - timedelta(days=3 if crawl == "both" else 0), score=64)
    if crawl in ("sample", "both"):
        _audit(db, bid, result={"pages": PAGES}, data_source="sample", score=99)
    for kind in extra_audits:  # other audit kinds with a result: the journey must not read them
        _audit(db, bid, kind=kind, result={"big": "x" * 500})
    for site in competitors:
        db.add(Competitor(business_id=bid, name=site or "none", website=site, selected=(None if site and "null" in site else (False if site and "unselected" in site else True)), listing={"big": "y" * 200}))
    for i, (status, sev) in enumerate(fixes):
        db.add(GrowthAction(business_id=bid, area="website", key=f"k{i}", period="fix", due_on=date.today(), title="t", status=status, how=["a"], verify={"v": 1}, evidence={"severity": sev} if sev else None))
    for i in range(posts):
        db.add(Post(business_id=bid, body="b", status="published", published_at=NOW - timedelta(days=i * 20)))
    for i in range(reviews):
        db.add(Review(business_id=bid, rating=5, reply_status="posted" if i % 2 else "none"))
    for i, state in enumerate(checks):
        db.add(BacklinkCheck(business_id=bid, source_url=f"https://src{i}.example/p", target="https://shop.example", state=state))
    if report is not None:
        db.add(GrowthReport(business_id=bid, period="week", period_start=date.today() - timedelta(days=7), period_end=date.today(), data={"big": "z"}, emailed_at=NOW if report == "emailed" else None))
    for i in range(articles):
        db.add(Article(business_id=bid, keyword=f"kw{i}"))
    for kind, status, approval in tasks:
        db.add(AgentTask(business_id=bid, agent="gbp", kind=kind, title="t", status=status, requires_approval=approval))
    db.commit()
    return bid


COMPETITORS = ["https://rival-one.example", "https://rival-two.example", "https://rival-three.example", "https://www.facebook.com/somebakery", "https://shop.example/x",
               "https://sister-site.example", "https://unselected-rival.example", "https://null-rival.example", "not a website", None]
FIXES = [("todo", "critical"), ("done", "serious"), ("unverified", "warning"), ("failed", None), ("blocked", "critical"), ("verified", "critical"), ("skipped", "critical")]
TASKS = [("gbp_post", "pending", True), ("review_reply", "pending", True), ("keyword_add", "pending", True), ("gbp_post", "pending", False), ("gbp_post", "applied", True), ("blog_draft", "pending", True)]


@pytest.fixture()
def projects():
    """A spread of projects: every combination the journey's rules look at."""
    db = SessionLocal()
    made = []
    sister = Business(name="Sister Site", website="https://sister-site.example", owner_id="7001", status="active")
    db.add(sister)
    db.commit()
    made.append(sister.id)
    made += [
        build(db, "P empty", website=None, crawl="none"),
        build(db, "P full", owner_id="7001", keywords=12, grouped=10, primaries=3, competitors=COMPETITORS, fixes=FIXES, posts=6, reviews=14, review_count=20, checks=["working"] * 6 + ["link_missing"],
              report="emailed", articles=2, tasks=TASKS, extra_audits=("gbp", "technical", "rankings", "backlinks", "citations", "website")),
        build(db, "P seo only", modules=["seo"], owner_id="7001", keywords=9, grouped=9, primaries=9, competitors=COMPETITORS[:4], fixes=[("verified", "critical")], report="notemailed", crawl="live"),
        build(db, "P no crawl", keywords=10, grouped=4, crawl="none", competitors=COMPETITORS[:2], reviews=3),
        build(db, "P sample crawl", keywords=10, grouped=10, crawl="sample", reviews=11, review_count=None),
        build(db, "P sample over live", keywords=10, grouped=2, crawl="both", posts=4),
        build(db, "P keywords, no competitors", keywords=3, crawl="live"),
        build(db, "P no keywords, crawl", crawl="live", competitors=COMPETITORS[:3], fixes=[("todo", "serious")]),
        build(db, "P geo", modules=["geo", "aeo"], keywords=8, grouped=8, crawl="live", articles=1),
    ]
    db.close()
    yield made
    db = SessionLocal()
    for bid in made:
        for model in (AgentTask, Article, Audit, BacklinkCheck, Competitor, GrowthAction, GrowthReport, Keyword, Post, Review):
            db.query(model).filter(model.business_id == bid).delete()
        db.query(Business).filter(Business.id == bid).delete()
    db.commit()
    db.close()


def statements(fn):
    seen: list[str] = []

    def grab(conn, cursor, statement, *a):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", grab)
    try:
        out = fn()
    finally:
        event.remove(engine, "before_cursor_execute", grab)
    return out, seen


# ── old versus new ────────────────────────────────────────────────────────────
def test_the_journey_is_identical_to_the_one_before_the_optimisation(projects):
    db = SessionLocal()
    for bid in projects:
        b = db.get(Business, bid)
        assert _json(flow.evaluate(db, b)) == _json(flow_reference.evaluate(db, b)), b.name
    db.close()


def test_random_projects_give_identical_journeys(projects):
    rnd = random.Random(11)
    db = SessionLocal()
    extra = []
    for i in range(12):
        extra.append(build(db, f"R {i}", modules=rnd.choice([None, ["seo"], ["seo", "gmb"], ["geo"]]), website=rnd.choice([None, "https://shop.example"]),
                           keywords=rnd.choice([0, 2, 8, 15]), grouped=rnd.choice([0, 3, 8]), primaries=rnd.choice([0, 2]), crawl=rnd.choice(["live", "sample", "both", "none"]),
                           competitors=rnd.sample(COMPETITORS, rnd.randint(0, 5)), fixes=rnd.sample(FIXES, rnd.randint(0, 4)), posts=rnd.randint(0, 6), reviews=rnd.randint(0, 12),
                           review_count=rnd.choice([None, 0, 15]), checks=rnd.choices(["working", "link_missing", "page_error"], k=rnd.randint(0, 8)),
                           report=rnd.choice([None, "emailed", "notemailed"]), articles=rnd.randint(0, 2), tasks=rnd.sample(TASKS, rnd.randint(0, 4))))
    try:
        for bid in extra:
            b = db.get(Business, bid)
            assert _json(flow.evaluate(db, b)) == _json(flow_reference.evaluate(db, b)), b.name
    finally:
        for bid in extra:
            for model in (AgentTask, Article, Audit, BacklinkCheck, Competitor, GrowthAction, GrowthReport, Keyword, Post, Review):
                db.query(model).filter(model.business_id == bid).delete()
            db.query(Business).filter(Business.id == bid).delete()
        db.commit()
        db.close()


# ── statements ────────────────────────────────────────────────────────────────
def test_a_typical_project_takes_about_eight_statements_instead_of_about_eighteen(projects):
    full = projects[2]  # "P full": 12 keywords, a crawl, 10 competitors, fixes, reviews, checks, a report, articles, tasks
    db = SessionLocal()
    b = db.get(Business, full)
    _, new = statements(lambda: flow.evaluate(db, b))
    _, old = statements(lambda: flow_reference.evaluate(db, b))
    db.close()
    print(f"\nSTATEMENTS for the same project: before={len(old)} after={len(new)}")
    assert len(new) <= 8, new
    assert len(old) >= 18 and len(new) < len(old) / 2


def test_a_project_without_keywords_reads_no_crawl_and_no_mapping_data(projects):
    nokw = projects[8]  # "P no keywords, crawl"
    db = SessionLocal()
    b = db.get(Business, nokw)
    _, new = statements(lambda: flow.evaluate(db, b))
    db.close()
    assert len(new) <= 7
    assert not [s for s in new if "audits.result" in s]  # the large crawl is not read when there is nothing to map


def test_no_large_json_is_read_for_a_small_fact(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    _, new = statements(lambda: flow.evaluate(db, b))
    db.close()
    text = "\n".join(new)
    # (keywords.source is read since the keyword mapping uses the page a keyword was planned for)
    for column in ("competitors.listing", "growth_actions.verify", "growth_actions.how", "growth_actions.why", "growth_actions.note", "growth_reports.data"):
        assert column not in text, column
    assert len([s for s in new if "audits.result" in s]) == 1  # the crawl: once, alone, and no intel / gbp / technical result
    assert "audits.issues" not in text
    assert not [s for s in new if "FROM audits" in s and "row_number" in s.lower()]  # audits.latest (the result of every kind of audit) is not used


def test_the_owners_other_websites_are_read_once_not_once_per_competitor(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    _, new = statements(lambda: flow.evaluate(db, b))
    _, old = statements(lambda: flow_reference.evaluate(db, b))
    db.close()
    sibling = lambda s: "businesses.website IS NOT NULL" in s  # noqa: E731
    assert len([s for s in new if sibling(s)]) == 1
    assert len([s for s in old if sibling(s)]) > 3


# ── permissions and the shared cache ──────────────────────────────────────────
def _user(email, role="editor", totp=False):
    db = SessionLocal()
    db.query(AppUser).filter_by(email=email).delete()
    db.add(AppUser(email=email, name=email.split("@")[0], role=role, password_hash=hash_password("a-long-enough-password")))
    db.commit()
    db.close()


def _forget(emails, business_ids):
    """The test database does not cascade and reuses ids: remove what a test made, so a later test never inherits a user's project."""
    db = SessionLocal()
    for bid in business_ids:
        for model in (AgentTask, Article, Audit, BacklinkCheck, Competitor, GrowthAction, GrowthReport, Keyword, Post, Review):
            db.query(model).filter(model.business_id == bid).delete()
        db.query(Business).filter(Business.id == bid).delete()
    for email in emails:
        db.query(AppUser).filter_by(email=email).delete()
    db.commit()
    db.close()


def _login(email):
    c = TestClient(app)
    assert c.post("/api/v1/auth/login", json={"email": email, "password": "a-long-enough-password"}).status_code == 200
    return c


@pytest.fixture()
def two_users():
    auth_router._failures.clear()
    _user("flow-a@x.in")
    _user("flow-b@x.in")
    a, b = _login("flow-a@x.in"), _login("flow-b@x.in")
    flow_router._journeys.clear()
    mine = a.post("/api/v1/businesses", json={"name": "Flow A Project", "website": "https://flow-a.example"}).json()["id"]
    theirs = b.post("/api/v1/businesses", json={"name": "Flow B Project", "website": "https://flow-b.example"}).json()["id"]
    yield a, b, mine, theirs
    flow_router._journeys.clear()
    auth_router._failures.clear()
    _forget(["flow-a@x.in", "flow-b@x.in"], [mine, theirs])


def test_a_user_cannot_open_another_users_project_flow(two_users):
    a, b, mine, theirs = two_users
    assert a.get(f"/api/v1/businesses/{mine}/flow").status_code == 200
    assert a.get(f"/api/v1/businesses/{theirs}/flow").status_code == 404
    assert b.get(f"/api/v1/businesses/{mine}/flow").status_code == 404
    assert a.get(f"/api/v1/businesses/{theirs}/flow/website-health").status_code == 404


def test_the_shared_journey_cache_never_shows_one_user_the_others_projects(two_users):
    a, b, mine, theirs = two_users
    first = a.get("/api/v1/flow/projects").json()["projects"]
    assert str(mine) in first and str(theirs) not in first
    # A's request worked out A's project only; now B asks while A's journey is in the shared cache.
    second = b.get("/api/v1/flow/projects").json()["projects"]
    assert str(theirs) in second and str(mine) not in second
    assert mine in flow_router._journeys and theirs in flow_router._journeys  # both are in the shared cache, yet each user is shown only their own
    assert str(mine) not in b.get("/api/v1/flow/projects").json()["projects"]
    assert str(theirs) not in a.get("/api/v1/flow/projects").json()["projects"]


def test_a_project_still_needs_the_authenticator_code_to_open_its_flow(monkeypatch):
    from app.services import totp
    step = [2_000_000]
    monkeypatch.setattr(totp, "current_step", lambda now=None: step[0])
    auth_router._failures.clear()
    _user("flow-2fa@x.in")
    c = _login("flow-2fa@x.in")
    bid = c.post("/api/v1/businesses", json={"name": "Flow 2FA"}).json()["id"]
    assert c.get(f"/api/v1/businesses/{bid}/flow").status_code == 200  # nothing asked until two-step verification is on
    secret = c.post("/api/v1/auth/2fa/setup").json()["secret"]
    step[0] += 1
    assert c.post("/api/v1/auth/2fa/enable", json={"code": totp.code_at(secret, step[0])}).status_code == 200
    r = c.get(f"/api/v1/businesses/{bid}/flow")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "project_code_required"
    step[0] += 1
    assert c.post("/api/v1/auth/switch-project", json={"business_id": bid, "code": totp.code_at(secret, step[0])}).status_code == 200
    assert c.get(f"/api/v1/businesses/{bid}/flow").status_code == 200
    auth_router._failures.clear()
    _forget(["flow-2fa@x.in"], [bid])


# ── the shared functions, called the way every other caller calls them ────────
def test_keyword_progress_with_its_defaults_is_unchanged(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    tracked = list(db.query(Keyword).filter(Keyword.business_id == full, Keyword.tracked.is_(True)))
    default = kwsvc.progress(db, b)
    assert default == kwsvc.progress(db, b, rows=tracked, check_research=True)  # handing it the rows changes nothing
    quick = kwsvc.progress(db, b, rows=tracked, check_research=False)
    assert {k: v for k, v in quick.items() if k not in ("researched", "steps", "next", "complete")} == {k: v for k, v in default.items() if k not in ("researched", "steps", "next", "complete")}
    db.close()


def test_progress_still_reads_the_competitor_research_by_default(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    db.add(Audit(business_id=full, kind="intel", target=f"business:{full}", status="done", result={"summary": {"x": 1}}, finished_at=NOW))
    db.commit()
    assert kwsvc.progress(db, b)["researched"] is True
    assert kwsvc.progress(db, b, check_research=False)["researched"] is False
    db.close()


def test_skip_reason_with_and_without_the_siblings_gives_the_same_answer(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    siblings = site_guard.sibling_hosts(db, b)
    assert "sister-site.example" in siblings
    for site in COMPETITORS + ["https://shop.example", "https://www.instagram.com/x", "https://linktr.ee/x", "https://rival-one.example/page"]:
        assert hygiene.skip_reason(b, site) == hygiene.skip_reason(b, site, siblings=siblings), site
    assert "another of your own websites" in hygiene.skip_reason(b, "https://sister-site.example")
    db.close()


def test_the_keyword_mapping_with_its_defaults_is_unchanged(projects):
    full = projects[2]
    db = SessionLocal()
    b = db.get(Business, full)
    from app.services import growth_content as gc
    default = keyword_mapping.plan(db, b)
    rows = list(db.execute(Keyword.__table__.select().where(Keyword.business_id == full, Keyword.tracked.is_(True))))
    assert default == keyword_mapping.plan(db, b, kws=rows, crawl=gc._crawl(db, b))
    assert default["crawled"] and default["keywords"] == 12
    db.close()


def test_no_keywords_and_no_competitors_and_missing_or_sample_crawls(projects):
    db = SessionLocal()
    by_name = {db.get(Business, i).name: i for i in projects}
    steps = lambda name: {s["key"]: s for s in flow.evaluate(db, db.get(Business, by_name[name]))["steps"]}  # noqa: E731
    assert steps("P empty")["mapping"]["detail"] == "Save keywords first."
    assert steps("P no keywords, crawl")["mapping"]["metric"] == "no keywords"
    assert steps("P no crawl")["mapping"]["metric"] == "website not scanned"
    assert steps("P sample crawl")["mapping"]["metric"] == "website not scanned"  # a sample crawl counts as no crawl
    assert steps("P sample over live")["mapping"]["metric"] == "website not scanned"  # the newest audit is a sample one
    assert steps("P sample over live")["website"]["metric"] == "64/100"  # while the site-audit step still finds the older live audit
    assert steps("P keywords, no competitors")["competitors"]["metric"] == "0 saved"
    assert "mapped" in steps("P full")["mapping"]["metric"] or "/" in steps("P full")["mapping"]["metric"]
    db.close()


def test_statement_counts_before_and_after_for_every_kind_of_project(projects):
    """Prints the counts (pytest -s) and checks the new journey never takes more statements than the old one."""
    db = SessionLocal()
    rows = []
    for bid in projects:
        b = db.get(Business, bid)
        _, new = statements(lambda: flow.evaluate(db, b))
        _, old = statements(lambda: flow_reference.evaluate(db, b))
        rows.append((b.name, len(old), len(new)))
        assert len(new) <= len(old), b.name
        assert len(new) <= 8, b.name
    db.close()
    print("\n" + "\n".join(f"  {n:28s} before={o:2d} after={a:2d}" for n, o, a in rows))
