"""The blog workflow: keywords -> topics, the site's layout, a task on the publish day, and promoting a published blog (overview, posted link check)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Article, BlogPromotion, Business, GrowthAction, Keyword, ScheduledPost
from app.services import ai, blog_flow, blog_promo
from app.services import backlink_checker as bc

BLOG = "https://blogco.example/blog/hello"


@pytest.fixture()
def biz(client):
    bid = client.post("/api/v1/businesses", json={"name": "Blog Co Dental", "website": "https://blogco.example/", "city": "Pune"}).json()["id"]
    db = SessionLocal()
    db.add(Keyword(business_id=bid, keyword="dental implants pune", volume=900, tracked=True))
    db.add(Keyword(business_id=bid, keyword="teeth whitening cost", volume=400, tracked=True))
    db.add(Article(business_id=bid, keyword="teeth whitening cost", status="completed", title="Old", body="<h2>x</h2>"))
    db.commit()
    yield bid, db
    db.close()


def _article(db, bid, **kw):
    a = Article(business_id=bid, keyword="dental implants pune", secondary_keywords=["implant cost"], status="completed", title="Dental Implants in Pune: A Plain Guide",
                meta_description="What dental implants involve, who needs them and what to ask.", topic="Dental implants", body="<p>Dental implants replace a missing tooth.</p><h2>Cost</h2><p>Ask for a written plan.</p><h2>FAQ</h2>", **kw)
    db.add(a)
    db.commit()
    return a


def test_keyword_pool_shows_volume_and_how_often_each_is_used(biz):
    bid, db = biz
    b = db.get(Business, bid)
    pool = blog_flow.keyword_pool(db, b)
    assert [k["keyword"] for k in pool] == ["dental implants pune", "teeth whitening cost"]
    assert pool[0]["used"] == 0 and pool[1]["used"] == 1


def test_topics_follow_the_chosen_keywords_with_and_without_ai(client, biz, monkeypatch):
    bid, db = biz
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    r = client.post(f"/api/v1/businesses/{bid}/blog-flow/topics", json={"keywords": ["Dental Implants Pune"]}).json()
    assert r["method"] == "rules" and r["topics"] and all(t["keyword"] == "dental implants pune" for t in r["topics"])
    assert client.post(f"/api/v1/businesses/{bid}/blog-flow/topics", json={"keywords": []}).status_code == 422
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda s, u, **k: {"topics": [{"title": "Are implants painful?", "keyword": "dental implants pune", "angle": "What the procedure feels like", "intent": "informational", "why": "A common worry"},
                                                                          {"title": "Off list", "keyword": "something else", "angle": "x", "why": "y"}]})
    r = client.post(f"/api/v1/businesses/{bid}/blog-flow/topics", json={"keywords": ["dental implants pune"]}).json()
    assert r["method"] == "ai" and [t["title"] for t in r["topics"]] == ["Are implants painful?"]


PAGES = {
    "https://blogco.example/": '<html><body><a href="/blog/">Blog</a></body></html>',
    "https://blogco.example/blog/": '<html><body><div class="post-card"><a href="/blog/hello">Hello</a><img src="a.jpg"><time>2026</time><p>' + "excerpt " * 30 + '</p></div></body></html>',
    BLOG: '<html><body><article><h1>Hello</h1><time>May 2026</time><img src="a.jpg"><h2>One</h2><p>' + "word " * 400 + '</p><h2>FAQ</h2><a class="btn" href="/contact">Contact us</a></article></body></html>',
}


def test_layout_check_reads_the_sites_blog_and_compares_the_article(client, biz, monkeypatch):
    bid, db = biz
    a = _article(db, bid)
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, PAGES[url], url, 5, None) if url in PAGES else (404, "", url, 5, "missing"))
    r = client.get(f"/api/v1/businesses/{bid}/blog-flow/layout", params={"article_id": a.id}).json()
    assert r["state"] == "ok" and r["listing_url"] == "https://blogco.example/blog/" and r["sample_post"] == BLOG
    assert r["post"]["featured_image"] and r["post"]["faq"] and r["post"]["cta"] and r["listing"]["cards_with_image"] == 1
    labels = {x["label"]: x["ok"] for x in r["fit"]}
    assert labels["A featured image is set (your posts and cards show one)"] is False  # none added yet
    assert labels["A FAQ section (your post has one)"] is True
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, '<html><body><a href="/about">About</a></body></html>', url, 5, None))
    assert client.get(f"/api/v1/businesses/{bid}/blog-flow/layout").json()["state"] == "no_blog"


def test_scheduling_adds_a_task_on_the_day_and_cancelling_closes_it(biz):
    bid, db = biz
    b = db.get(Business, bid)
    a = _article(db, bid)
    due = datetime.now(timezone.utc) + timedelta(days=3)
    blog_flow.schedule_task(db, b, a, due)
    db.commit()
    t = db.scalar(select(GrowthAction).where(GrowthAction.key == f"blog.publish.{a.id}"))
    assert t.period == "day" and t.status == "todo" and t.verify == {"type": "blog_published", "article_id": a.id} and t.link.endswith(f"article={a.id}")
    blog_flow.schedule_task(db, b, a, due + timedelta(days=2))  # rescheduled: the same task moves
    db.commit()
    assert db.query(GrowthAction).filter(GrowthAction.key == f"blog.publish.{a.id}").count() == 1
    blog_flow.cancel_task(db, b, a)
    db.commit()
    assert db.get(GrowthAction, t.id).status == "skipped"


def _publish(db, a, url=BLOG):
    db.add(ScheduledPost(business_id=a.business_id, article_id=a.id, method="wordpress", due_at=datetime.now(timezone.utc), status="published", result={"url": url}))
    db.commit()


def test_publishing_creates_the_promotion_plan_and_a_task_and_the_task_is_verified_by_real_links(client, biz, monkeypatch):
    from app.services import growth_content
    bid, db = biz
    b = db.get(Business, bid)
    a = _article(db, bid)
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    assert client.get(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}").json()["published"] is False
    assert client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/add", json={"name": "Local Biz Forum", "url": "forum.example/new"}).status_code == 200
    _publish(db, a)
    blog_flow.after_published(db, b, a)
    blog_flow.after_published(db, b, a)  # again: nothing is duplicated
    keys = [x.platform for x in db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == a.id))]
    assert "linkedin" in keys and "medium" in keys and "devto" not in keys and "pinterest" not in keys and len(keys) == len(set(keys))
    assert db.query(GrowthAction).filter(GrowthAction.key == f"blog.promote.{a.id}").count() == 1

    st = client.get(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}").json()
    assert st["published"] and st["url"] == BLOG
    li = next(x for x in st["items"] if x["platform"] == "linkedin")
    ov = client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/{li['id']}/overview", json={}).json()
    assert ov["overview"]["method"] == "rules" and BLOG in ov["overview"]["text"] and len(ov["overview"]["text"]) <= 1300
    xid = next(x["id"] for x in st["items"] if x["platform"] == "x")
    assert len(client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/{xid}/overview", json={}).json()["overview"]["text"]) <= 250

    # the user posts; the page is opened and checked for the blog's link
    seen = []

    def fake_check(url, tgt):
        seen.append((url, tgt))
        return {"state": "working", "follow": "nofollow", "http_status": 200, "link": {"anchor": "Read the full article"}, "error": None, "checked_at": "now"}
    monkeypatch.setattr(bc, "check_one", fake_check)
    r = client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/{li['id']}/posted", json={"url": "https://linkedin.com/posts/x-123"}).json()
    row = next(x for x in r["items"] if x["platform"] == "linkedin")
    assert row["status"] == "verified" and row["check"]["follow"] == "nofollow" and seen[0][0] == "https://linkedin.com/posts/x-123"
    assert client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/{li['id']}/posted", json={"url": "not a url"}).status_code == 422

    monkeypatch.setattr(bc, "check_one", lambda url, tgt: {"state": "link_missing", "follow": None, "http_status": 200, "link": None, "error": None, "checked_at": "now"})
    r = client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/check-all").json()
    assert next(x for x in r["items"] if x["platform"] == "linkedin")["status"] == "problem"

    # the Growth tasks are decided by those real checks
    rule = {"type": "blog_promo", "article_id": a.id, "min": 3}
    assert growth_content.verify(db, b, rule, None, datetime.now().date())["passed"] is False
    assert growth_content.verify(db, b, {"type": "blog_published", "article_id": a.id}, None, datetime.now().date())["passed"] is True


def test_overview_with_ai_keeps_the_real_link_and_the_size(client, biz, monkeypatch):
    bid, db = biz
    a = _article(db, bid)
    _publish(db, a)
    b = db.get(Business, bid)
    blog_flow.after_published(db, b, a)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda s, u, **k: {"text": "Thinking about dental implants in Pune? " * 40, "hashtags": ["#dental", "bad"]})
    x = db.scalar(select(BlogPromotion).where(BlogPromotion.article_id == a.id, BlogPromotion.platform == "x"))
    ov = client.post(f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}/{x.id}/overview", json={}).json()["overview"]
    assert ov["method"] == "ai" and ov["text"].endswith(BLOG) and len(ov["text"]) <= 250 and ov["hashtags"] == ["#dental"]


def test_another_projects_article_is_not_reachable(client, biz):
    bid, db = biz
    other = client.post("/api/v1/businesses", json={"name": "Other"}).json()["id"]
    a = _article(db, bid)
    assert client.get(f"/api/v1/businesses/{other}/blog-flow/promo/{a.id}").status_code == 404
