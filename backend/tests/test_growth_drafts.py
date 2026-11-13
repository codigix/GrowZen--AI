"""AI drafts for fix tasks, the keyword-to-content plan, backlink prospect tasks, report keyword movement and PDF, and the mail retry (offline)."""
import smtplib
from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import SessionLocal
from app.models import Business, GrowthAction, Keyword, KeywordRankLog, Post
from app.services import ai, growth_content as gc, growth_drafts as gd, growth_issues as gi, growth_report as gr, notify

TODAY = date(2026, 11, 13)


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Rental Co", "city": "Pune", "website": "https://rental.example", "contact_email": "o@rental.example"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def task(db, bid, key, verify=None, link="/x"):
    a = GrowthAction(business_id=bid, area="seo", key=key, period="fix", due_on=TODAY, title="t", status="todo", verify=verify or {}, link=link, evidence={"severity": "warning"})
    db.add(a)
    db.flush()
    return a


def fake_ai(monkeypatch, answer):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: answer)
    monkeypatch.setattr(ai, "profile_text", lambda b: "Rental Co rents designer outfits in Pune")


# ------------------------------------------------------------------------------------------------------------------- drafts
def test_a_meta_draft_is_cut_to_length_and_reports_which_keywords_it_used(project, monkeypatch):
    fake_ai(monkeypatch, {"title": "Designer lehenga rental in Pune | Rental Co " + "x" * 80, "description": "Rent a designer lehenga in Pune for your wedding. " * 6, "h1": "Lehenga rental in Pune"})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        a = task(db, project, "fix.kw.use.website", {"type": "kw_used", "surface": "website", "keywords": ["lehenga rental in pune", "bridal sherwani"]})
        d = gd.save(db, b, a)
        assert d["kind"] == "meta" and len(d["data"]["title"]) <= 60 and len(d["data"]["description"]) <= 160
        assert d["keyword_used"] == {"lehenga rental in pune": True, "bridal sherwani": False}  # the draft is honest about what it missed
        assert a.evidence["draft"]["kind"] == "meta" and a.evidence["severity"] == "warning"  # the task's other evidence survives
    finally:
        db.close()


def test_no_draft_without_ai_or_for_steps_only_a_person_can_do(project, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Keyword(business_id=project, keyword="lehenga rental pune", tracked=True))
        db.flush()
        with pytest.raises(gd.DraftError, match="not set up"):
            gd.build(db, b, task(db, project, "fix.kw.use.posts"))
        with pytest.raises(gd.DraftError, match="only you"):
            gd.build(db, b, task(db, project, "fix.bl.few"))
    finally:
        db.close()


def test_per_topic_task_keys_still_get_the_right_kind(project):
    db = SessionLocal()
    try:
        assert gd.kind_of(task(db, project, "fix.kw.use.posts.clothes")) == "post"
        assert gd.kind_of(task(db, project, "fix.kw.use.services.clothes")) == "profile"
        assert gd.kind_of(task(db, project, "fix.kw.use.blog.clothes")) == "blog"
        assert gd.kind_of(task(db, project, "fix.site.meta.title_missing")) == "meta"
        assert gd.kind_of(task(db, project, "fix.bl.few")) is None
    finally:
        db.close()


def test_a_post_draft_is_saved_as_a_draft_post_once_and_never_published(project, monkeypatch):
    fake_ai(monkeypatch, {"title": "New lehengas", "body": "Rent a designer lehenga in Pune. Book a trial today.", "cta_type": "BOOK"})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Keyword(business_id=project, keyword="lehenga rental pune", tracked=True))
        db.flush()
        a = task(db, project, "fix.kw.use.posts", {"type": "kw_used", "surface": "posts", "keywords": ["lehenga rental pune"]})
        gd.save(db, b, a)
        post = gd.apply_post(db, b, a)
        assert post.status == "draft" and post.ai_generated is True and post.cta_type == "BOOK"
        with pytest.raises(gd.DraftError, match="already"):
            gd.apply_post(db, b, a)
        assert db.query(Post).filter_by(business_id=project).count() == 1
    finally:
        db.close()


def test_the_draft_endpoints_are_scoped_and_explain_failures(client, project, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    db = SessionLocal()
    a = task(db, project, "fix.kw.use.posts")
    db.commit()
    aid = a.id
    db.close()
    r = client.post(f"/api/v1/businesses/{project}/growth/actions/{aid}/draft")
    assert r.status_code == 409 and "AI is not set up" in r.json()["detail"]
    assert client.post(f"/api/v1/businesses/{project}/growth/actions/999999/draft").status_code == 404
    assert client.post(f"/api/v1/businesses/{project}/growth/actions/{aid}/draft/apply").status_code == 409


def test_prefill_writes_drafts_for_open_tasks_without_repeating(project, monkeypatch):
    fake_ai(monkeypatch, {"title": "Guide to lehenga rental", "meta_description": "m" * 120, "intro": "Intro text.", "headings": ["What does it cost?", "How to choose"]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Keyword(business_id=project, keyword="lehenga rental pune", tracked=True))
        db.flush()
        task(db, project, "fix.blog.none")
        task(db, project, "fix.bl.few")
        assert gd.prefill(db, b) == 1
        assert gd.prefill(db, b) == 0
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- content plan and prospects
def test_the_content_plan_shows_each_topic_against_each_place(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {"pages": [{"url": "https://rental.example/l", "status": 200, "title": "Lehenga rental in Pune", "h1": "Lehenga rental"}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([Keyword(business_id=project, keyword="lehenga rental in pune", volume=300, tracked=True, cluster="Lehenga"), Keyword(business_id=project, keyword="rental co", tracked=True, cluster="Brand")])
        db.commit()
        plan = gc.content_plan(db, b)
        assert [t["topic"] for t in plan["topics"]] == ["Lehenga"]  # the brand keyword is not planned
        cov = plan["topics"][0]["coverage"]
        assert cov["website"]["done"] is True and cov["blog"]["missing"] == ["lehenga rental in pune"] and plan["topics"][0]["next"] == "profile"
    finally:
        db.close()


def test_topic_issues_replace_the_global_ones_once_keywords_are_grouped(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([Keyword(business_id=project, keyword="lehenga rental in pune", volume=300, tracked=True, cluster="Lehenga"), Keyword(business_id=project, keyword="sherwani rental pune", volume=100, tracked=True, cluster="Sherwani")])
        db.commit()
        keys = {i["key"] for i in gc.issues(db, b, None)}
        assert "fix.kw.use.posts.lehenga" in keys and "fix.kw.use.posts.sherwani" in keys and "fix.kw.use.posts" not in keys
        assert "fix.kw.use.services.lehenga" in keys
    finally:
        db.close()


def test_a_backlink_prospect_becomes_one_task_that_closes_when_the_link_exists(project, monkeypatch):
    from app.backlinks.models import BiTrackedTarget
    monkeypatch.setattr(gc, "_gap", lambda db, b: ("rental.example", []))
    monkeypatch.setattr(gc, "_gap", lambda db, b: ("rental.example", [{"domain": "weddingguide.in", "competitors": ["a.com", "b.com"], "backlinks": 3, "crawler_verified": 1}]))
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        out = gc._prospect_issues(db, b, {"domain": "rental.example", "backlinks": 0, "referring_domains": 0})
        assert out[0]["key"] == "fix.bl.prospect.weddingguide-in" and "money" in " ".join(out[0]["how"]) and out[0]["verify"] == {"type": "bl_prospect", "domain": "weddingguide.in"}
        from app.backlinks import analytics
        db.add(BiTrackedTarget(business_id=project, domain="rental.example", is_competitor=False))
        db.flush()
        monkeypatch.setattr(analytics, "referring_domains", lambda db, d: {})
        assert gc.verify(db, b, out[0]["verify"], None, TODAY)["passed"] is False
        monkeypatch.setattr(analytics, "referring_domains", lambda db, d: {"weddingguide.in": {}})
        assert gc.verify(db, b, out[0]["verify"], None, TODAY)["passed"] is True
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- report extras and mail
def test_the_report_shows_real_keyword_movement_and_renders_a_pdf(project, monkeypatch):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([KeywordRankLog(business_id=project, keyword="lehenga rental pune", day=date(2026, 11, 1), rank=18, maps_rank=None),
                    KeywordRankLog(business_id=project, keyword="lehenga rental pune", day=date(2026, 11, 8), rank=9, maps_rank=4),
                    KeywordRankLog(business_id=project, keyword="new keyword", day=date(2026, 11, 7), rank=None)])
        db.commit()
        d = gr.generate(db, b, "week", None, date(2026, 11, 9)).data
        k = {x["keyword"]: x for x in d["keywords"]}
        assert k["lehenga rental pune"]["start"] == 18 and k["lehenga rental pune"]["end"] == 9 and k["lehenga rental pune"]["change"] == 9 and k["lehenga rental pune"]["maps_end"] == 4
        assert k["new keyword"]["start"] is None and k["new keyword"]["found"] is False  # one check is a level, not a movement
        pdf = gr.render_pdf({**d, "business": {"name": "<b>Evil & Co</b>"}})
        assert pdf.startswith(b"%PDF-") and len(pdf) > 1500
        assert "Keyword rankings" in gr.render_text(d)
    finally:
        db.close()


def test_the_pdf_endpoint_returns_a_download(client, project):
    r = client.post(f"/api/v1/businesses/{project}/growth/reports/generate", json={"period": "week", "current": True})
    rid = r.json()["id"]
    pdf = client.get(f"/api/v1/businesses/{project}/growth/reports/{rid}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF-") and "attachment" in pdf.headers["content-disposition"]
    assert client.get(f"/api/v1/businesses/{project}/growth/reports/999999/pdf").status_code == 404


def test_the_mail_is_retried_once_after_a_dropped_connection(monkeypatch):
    calls = []

    class Flaky:
        def __init__(self, *a, **k):
            calls.append(1)
            if len(calls) == 1:
                raise smtplib.SMTPServerDisconnected("dropped")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, *a):
            pass

        def send_message(self, m):
            calls.append("sent")

    from app.config import get_settings
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example", raising=False)
    monkeypatch.setattr(s, "smtp_from", "from@example.com", raising=False)
    monkeypatch.setattr(notify.smtplib, "SMTP", Flaky)
    monkeypatch.setattr(notify.time, "sleep", lambda n: None)
    assert notify.send_email("to@example.com", "s", "b") is True and calls == [1, 1, "sent"]
    calls.clear()
    monkeypatch.setattr(notify.smtplib, "SMTP", lambda *a, **k: (_ for _ in ()).throw(smtplib.SMTPServerDisconnected("down")))
    with pytest.raises(smtplib.SMTPServerDisconnected):
        notify.send_email("to@example.com", "s", "b")  # a second failure is real and is reported


def test_prospects_are_added_only_by_start_never_closed_by_the_sweep_and_a_slow_graph_is_reported(project, monkeypatch):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        monkeypatch.setattr(gc, "_own_links", lambda db, b: {"domain": "rental.example", "backlinks": 0, "referring_domains": 0})
        monkeypatch.setattr(gc, "_gap", lambda db, b: ("rental.example", [{"domain": "weddingguide.in", "competitors": ["a.com"], "backlinks": 2, "crawler_verified": 0}]))
        r = gc.add_prospects(db, b, TODAY)
        assert r["created"] == 1 and gc.add_prospects(db, b, TODAY)["created"] == 0  # once
        monkeypatch.setattr(gi, "collect", lambda db, b, live=False: {"issues": [], "skipped": [], "total_found": 0, "all_keys": set()})
        assert gi.sweep(db, b, TODAY)["closed"] == 0  # the sweep does not know about prospects: only their own link check closes them
        monkeypatch.setattr(gc, "_gap", lambda db, b: (_ for _ in ()).throw(TimeoutError("slow")))
        slow = gc.add_prospects(db, b, TODAY)
        assert slow["created"] == 0 and "could not be read" in slow["note"]
    finally:
        db.close()


def test_the_sweep_itself_never_reads_the_competitor_link_gap(project, monkeypatch):
    called = []
    monkeypatch.setattr(gc, "_gap", lambda db, b: called.append(1) or ("x", []))
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {})
    db = SessionLocal()
    try:
        gc.issues(db, db.get(Business, project), None)
        assert called == []
    finally:
        db.close()


def test_keywords_that_ignore_the_words_the_website_uses_are_flagged(project, monkeypatch):
    monkeypatch.setattr(gc, "_crawl", lambda db, b: {"pages": [{"url": "https://rental.example/", "status": 200, "title": "Rental Co | Premium Lehenga Hire", "meta_description": "Lehenga hire for weddings", "h1": "Designer lehenga hire in Pune"}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Keyword(business_id=project, keyword="clothes market in pune", volume=100, tracked=True))
        db.flush()
        assert gc.site_terms(b, None, gc._crawl(db, b)) == ["hire", "lehenga"]  # the brand word and filler are left out
        issue = next(i for i in gc.issues(db, b, None) if i["key"] == "fix.kw.site_terms")
        assert issue["severity"] == "serious" and "lehenga" in issue["why"] and issue["verify"]["type"] == "kw_terms"
        assert gc.verify(db, b, issue["verify"], None, TODAY)["passed"] is False
        db.add(Keyword(business_id=project, keyword="lehenga hire in pune", tracked=True))
        db.flush()
        assert gc.verify(db, b, issue["verify"], None, TODAY)["passed"] is True
        assert "fix.kw.site_terms" not in {i["key"] for i in gc.issues(db, b, None)}
    finally:
        db.close()


def test_competitor_hygiene_rejects_self_social_and_link_pages(client, project):
    from types import SimpleNamespace

    from app.competitors import hygiene
    me = SimpleNamespace(website="https://www.rental.example/")
    assert hygiene.skip_reason(me, "https://rental.example/about") == "That is your own website."
    assert "social network" in hygiene.skip_reason(me, "https://www.instagram.com/rival")
    assert "link page" in hygiene.skip_reason(me, "https://linktr.ee/rival")
    assert hygiene.skip_reason(me, "not a url") is not None
    assert hygiene.skip_reason(me, "https://rival-rentals.in/") is None
    r = client.post(f"/api/v1/competitors/manual", json={"business_id": project, "url": "https://instagram.com/rival"})
    assert r.status_code == 400 and "social" in r.json()["detail"]


def test_saved_polluted_competitors_become_a_task_that_closes_when_they_are_removed(project):
    from app.models import Competitor
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add_all([Competitor(business_id=project, name="Rival IG", website="https://www.instagram.com/rival", source="manual"), Competitor(business_id=project, name="Real Rival", website="https://rival.in", source="manual")])
        db.flush()
        issue = next(i for i in gc.issues(db, b, None) if i["key"] == "fix.comp.invalid")
        assert "Rival IG" in issue["why"] and "Real Rival" not in issue["why"]
        assert gc.verify(db, b, issue["verify"], None, TODAY)["passed"] is False
        db.query(Competitor).filter_by(business_id=project, name="Rival IG").delete()
        db.flush()
        assert gc.verify(db, b, issue["verify"], None, TODAY)["passed"] is True
    finally:
        db.close()
