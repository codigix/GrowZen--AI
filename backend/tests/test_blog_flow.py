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


def test_saved_competitors_that_cannot_be_read_are_explained_and_one_can_be_switched_on(client, biz, monkeypatch):
    """Competitors are saved, but the selected ones are only on Google Maps (no website) and the ones with a website were left out: the page says so,
    instead of asking to add competitors, and offers to use the ones with a website."""
    from app.models import Competitor
    bid, db = biz
    a = _article(db, bid)
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    base = f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}"
    _publish(db, a)
    assert client.get(base).json()["from_competitors"]["saved"] == {"total": 0, "no_website": [], "left_out": []}  # truly none: "Add your competitors"
    db.add_all([Competitor(business_id=bid, name="Mrugini Rental Studio", website=None, source="google_places", selected=True),
                Competitor(business_id=bid, name="Yashodhara Boutique", website=None, source="google_places", selected=False),
                Competitor(business_id=bid, name="Rentozone", website="http://www.rentozone.example/", source="research", selected=False),
                Competitor(business_id=bid, name="Instagram page", website="https://www.instagram.com/x", source="research", selected=False)])  # never a competitor domain
    db.commit()
    comp = client.get(base).json()["from_competitors"]
    assert comp["state"] == "no_competitors"
    assert comp["saved"]["total"] == 4 and comp["saved"]["no_website"] == ["Mrugini Rental Studio"]  # selected, but nothing to read
    left = comp["saved"]["left_out"]
    assert [(c["name"], c["domain"]) for c in left] == [("Rentozone", "rentozone.example")]  # has a website, left out; Instagram is not offered
    assert client.patch(f"/api/v1/competitors/{left[0]['id']}", json={"selected": True}).status_code == 200  # "Use this competitor"
    comp = client.get(base).json()["from_competitors"]
    assert comp["state"] != "no_competitors" and comp["competitors"] == ["rentozone.example"]


def test_promotion_shows_where_competitors_promote_their_blog_articles(client, biz, monkeypatch):
    from app.backlinks.models import BiTrackedTarget
    from app.backlinks.repository import LinkRecord, upsert_imported_link
    bid, db = biz
    a = _article(db, bid)
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    base = f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}"
    _publish(db, a)
    assert client.get(base).json()["from_competitors"]["state"] == "no_competitors"
    db.add_all([BiTrackedTarget(business_id=bid, domain="blogco.example"), BiTrackedTarget(business_id=bid, domain="rival.example", is_competitor=True),
                BiTrackedTarget(business_id=bid, domain="rival2.example", is_competitor=True)])
    db.commit()
    assert client.get(base).json()["from_competitors"]["state"] == "no_data"
    for src, tgt, anchor in (
        ("https://dentalforum.example/threads/implants", "https://rival.example/blog/dental-implants-cost-guide", "dental implants cost"),
        ("https://dentalforum.example/threads/whitening", "https://rival2.example/blog/teeth-whitening-at-home", "whitening"),
        ("https://citynews.example/health", "https://rival.example/blog/why-we-love-pune", "pune"),
        ("https://homelink.example/x", "https://rival.example/", "Rival"),  # a home page, not an article: no suggestion
        ("https://cheap-backlinks-casino.xyz/p", "https://rival.example/blog/dental-implants-cost-guide", "buy cheap backlinks"),  # spammy: never suggested
        ("https://medium.com/@rival/implants", "https://rival.example/blog/dental-implants-cost-guide", "implants"),  # a fixed platform: a badge on its row
        ("https://rivalstore.myshopify.com/products/x", "https://rival.example/blog/dental-implants-cost-guide", "shop"),  # the competitor's own shop: not promotion
        ("https://deals.example/list", "https://rival.example/products/dental-floss-pack-of-three", "floss"),  # a product page, not an article
    ):
        upsert_imported_link(db, LinkRecord(src, tgt, anchor), "manual_import")
    db.commit()
    st = client.get(base).json()
    comp = st["from_competitors"]
    doms = [x["domain"] for x in comp["items"]]
    assert comp["state"] == "ok" and doms[0] == "dentalforum.example"  # both competitors, same topic: first
    assert "homelink.example" not in doms and "cheap-backlinks-casino.xyz" not in doms and "medium.com" not in doms
    first = comp["items"][0]
    assert first["competitors"] == ["rival.example", "rival2.example"] and first["topic"] == "same" and first["example"]["competitor_article"].endswith("dental-implants-cost-guide")
    rival = next(c for c in comp["by_competitor"] if c["competitor"] == "rival.example")
    assert rival["articles"][0]["url"].endswith("dental-implants-cost-guide")  # closest to this blog's topic first
    linked = {ln["domain"]: ln for ln in rival["articles"][0]["links"]}
    assert {"dentalforum.example", "medium.com", "cheap-backlinks-casino.xyz"} <= set(linked) and "homelink.example" not in linked and "myshopify.com" not in linked
    assert "deals.example" not in [x["domain"] for x in comp["items"]]
    assert linked["cheap-backlinks-casino.xyz"]["useful"] == "risky"  # shown in the analysis, marked, but never suggested
    medium = next(i for i in st["items"] if i["platform"] == "medium")
    assert medium["competitor_use"]["competitors"] == ["rival.example"]
    r = client.post(f"{base}/add-from-competitor", json={"domain": "dentalforum.example"})
    assert r.status_code == 200
    row = next(i for i in r.json()["items"] if i["name"] == "dentalforum.example")
    assert row["open_url"].startswith("https://dentalforum.example/") and row["status"] == "planned"
    assert "dentalforum.example" not in [x["domain"] for x in r.json()["from_competitors"]["items"]]  # in the plan now: no longer suggested
    assert client.post(f"{base}/add-from-competitor", json={"domain": "unknown.example"}).status_code == 422


RIVAL = {
    "https://rival.example/": '<html><body><a href="/blog/">Blog</a><a href="https://www.linkedin.com/company/rival">LinkedIn</a><a href="/contact">Contact</a></body></html>',
    "https://rival.example/blog/": '<html><body><a href="/blog/dental-implants-cost-guide">A</a><a href="/blog/teeth-whitening-at-home">B</a><a href="/blog/category/news">C</a></body></html>',
    "https://rival.example/blog/dental-implants-cost-guide": '<html><body><article>Also on <a href="https://medium.com/@rival/dental-implants-cost-guide-1a2b">Medium</a></article></body></html>',
    "https://rival.example/blog/teeth-whitening-at-home": '<html><body><p>No outside links.</p></body></html>',
}


def test_competitor_website_research_finds_its_blog_articles_and_platforms(client, biz, monkeypatch):
    from app.backlinks.models import BiTrackedTarget
    from app.services import competitor_blogs as cb
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, RIVAL[url], url, 5, None) if url in RIVAL else (404, "", url, 5, "missing"))
    r = cb.research("rival.example")
    assert r["reachable"] and r["blog_url"] == "https://rival.example/blog/"
    assert r["articles"] == ["https://rival.example/blog/dental-implants-cost-guide", "https://rival.example/blog/teeth-whitening-at-home"]  # the category page is not an article
    by = {p["name"]: p for p in r["platforms"]}
    assert by["Medium"]["posts"] == 1 and by["Medium"]["evidence"].startswith("An article") and by["Medium"]["seen_on"].endswith("dental-implants-cost-guide")
    assert by["LinkedIn"]["posts"] == 0 and by["LinkedIn"]["kind"] == "social"
    assert "Medium" not in r["not_found"] and "Blogger" in r["not_found"]
    assert not cb.research("down.example")["reachable"]
    bid, db = biz
    a = _article(db, bid)
    _publish(db, a)
    db.add_all([BiTrackedTarget(business_id=bid, domain="blogco.example"), BiTrackedTarget(business_id=bid, domain="rival.example", is_competitor=True)])
    db.commit()
    base = f"/api/v1/businesses/{bid}/blog-flow/promo/{a.id}"
    assert client.get(base).json()["from_competitors"]["research"] == {"running": False, "done": 0, "total": 1}
    assert client.post(f"{base}/research-competitors").status_code == 202  # the test client runs the background task before it returns
    comp = client.get(base).json()["from_competitors"]
    assert comp["research"]["done"] == 1
    row = comp["by_competitor"][0]
    assert row["competitor"] == "rival.example" and [p["name"] for p in row["site"]["platforms"]] == ["Medium", "LinkedIn"]


LONG = "<p>" + "dental implants explained in plain words " * 60 + "</p>"
WEB = {
    "https://smileblog.example/implants-guide": f'<html><body><article><h1>Implants</h1>{LONG}<a href="https://clinic.example/">a clinic</a><a href="/write-for-us">Write for us</a></article></body></html>',
    "https://smileblog.example/write-for-us": "<html><body><h1>Write for us</h1><p>We accept guest posts on dental health. Submission is free of charge.</p></body></html>",
    "https://dentalnews.example/sponsored": f'<html><body><article>{LONG}<a rel="nofollow" href="https://x.example/">x</a></article><a href="/advertise">Advertise</a></body></html>',
    "https://dentalnews.example/advertise": "<html><body>Sponsored posts: ₹5000 per post. Advertise with us.</body></html>",
    "https://medium.com/@doc/implants-101-abc": f"<html><body><article>{LONG}</article></body></html>",
    "https://quietsite.example/page": "<html><body><p>Short page.</p></body></html>",
}


def test_web_discovery_finds_publishing_sites_beyond_competitors_and_verifies_them(client, biz, monkeypatch):
    from app.config import get_settings
    from app.services import publish_discovery as pd
    bid, db = biz
    a = _article(db, bid)
    base = f"/api/v1/businesses/{bid}/blog-flow/discovery/{a.id}"
    monkeypatch.setattr(get_settings(), "serper_api_key", "")
    assert client.get(base).json()["state"] == "no_search"
    monkeypatch.setattr(get_settings(), "serper_api_key", "k")
    asked = []
    hits = [{"link": "https://smileblog.example/implants-guide", "title": "Dental implants guide - Smile Blog"}, {"link": "https://dentalnews.example/sponsored", "title": "Sponsored: implants"},
            {"link": "https://medium.com/@doc/implants-101-abc", "title": "Implants 101"}, {"link": "https://quietsite.example/page", "title": "Quiet"},
            {"link": "https://www.youtube.com/watch?v=1", "title": "video"}, {"link": "https://blogco.example/blog/x", "title": "our own site"},
            {"link": "https://www.facebook.com/somepage", "title": "fb"}]
    monkeypatch.setattr(pd, "_search", lambda q, country: (asked.append(q), hits)[1])
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, WEB[url], url, 5, None) if url in WEB else (404, "", url, 5, "missing"))
    assert client.get(base).json()["state"] == "not_run"
    assert client.post(f"{base}/run").status_code == 202
    d = client.get(base).json()
    assert d["state"] == "ok" and asked and any("dental implants pune" in q for q in asked) and any('"write for us"' in q for q in asked)
    by = {i["domain"]: i for i in d["items"]}
    assert set(by) == {"smileblog.example", "dentalnews.example", "medium.com", "quietsite.example"}  # not YouTube, Facebook or our own site
    s = by["smileblog.example"]
    assert s["platform"] == "Website / industry blog" and s["article_verified"] and s["publishing"] == {**s["publishing"], "type": "free", "verified": True}
    assert s["publishing"]["evidence_url"].endswith("/write-for-us") and s["links_out"]["follow"] == 1 and s["backlink"] == "likely"
    assert by["dentalnews.example"]["publishing"]["type"] == "paid" and by["dentalnews.example"]["publishing"]["verified"]
    m = by["medium.com"]
    assert m["platform"] == "Medium" and m["publishing"]["type"] == "open" and m["publishing"]["known"] and not m["publishing"]["verified"]
    q = by["quietsite.example"]
    assert q["publishing"] == {"type": "unknown", "verified": False, "evidence_url": None, "evidence": None} and not q["article_verified"]
    r = client.post(f"{base}/save", json={"domain": "smileblog.example"})
    assert r.status_code == 200 and next(i for i in r.json()["items"] if i["domain"] == "smileblog.example")["saved"] == "planned"
    assert client.post(f"{base}/save", json={"domain": "nowhere.example"}).status_code == 422


def test_web_discovery_falls_back_to_ai_suggestions_that_are_still_verified(client, biz, monkeypatch):
    from app.config import get_settings
    from app.services import publish_discovery as pd
    bid, db = biz
    a = _article(db, bid)
    base = f"/api/v1/businesses/{bid}/blog-flow/discovery/{a.id}"
    monkeypatch.setattr(get_settings(), "serper_api_key", "k")

    def no_credits(q, country):
        raise ValueError("The search service (Serper) has no credits left: top up the Serper account, then search again.")
    monkeypatch.setattr(pd, "_search", no_credits)
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda s, u, **k: {"sites": [{"domain": "smileblog.example", "name": "Smile Blog", "page": "https://smileblog.example/implants-guide", "topic": "dental implants pune"},
                                                                        {"domain": "not a domain", "name": "x"}, {"domain": "www.youtube.com", "name": "yt"}]})
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, WEB[url], url, 5, None) if url in WEB else (404, "", url, 5, "missing"))
    client.post(f"{base}/run")
    d = client.get(base).json()
    assert d["state"] == "ok" and d["source"] == "ai" and "no credits" in d["message"]
    assert [i["domain"] for i in d["items"]] == ["smileblog.example"] and d["items"][0]["found_by"] == ["AI suggestion"]
    assert d["items"][0]["publishing"]["verified"] and d["items"][0]["publishing"]["type"] == "free"  # checked on the site itself


def _rental_shop():
    """A clothing-rental shop in Pune whose category ("Clothes market") says less than its services do."""
    b = Business(name="Rental Shop", category=None) if False else Business(name="Rental Shop")
    b.primary_category, b.city, b.area, b.country = "Clothes market", "Pune", "Wagholi", "IN"
    b.services = [{"name": "Rental cloths"}, {"name": "Cloths on rent in wagholi"}]
    a = Article(keyword="fashion cloth", secondary_keywords=["fashion designer clothes", "mens fashion clothes"], status="completed")
    return b, a


def test_the_niche_is_what_the_business_sells_not_just_its_category():
    from app.services import publish_discovery as pd
    b, a = _rental_shop()
    assert pd.topics_of(b, a) == ["fashion cloth", "rental cloths", "cloths on rent in wagholi", "fashion designer clothes", "mens fashion clothes"]
    assert pd.topics_of(b, None) == ["rental cloths", "cloths on rent in wagholi", "clothes market"]
    qs = [x["q"] for x in pd.queries(b, a)]
    assert any(q.startswith('rental cloths "write for us"') for q in qs)  # guest posts are looked for in what it sells, not in "clothes market"
    assert any(q.startswith("wedding blog") for q in qs) and any(q.startswith("bridal blog") for q in qs) and any(q.startswith("fashion blog") for q in qs)
    assert any("Pune lifestyle blog" in q for q in qs) and not any('"clothes market" "write for us"' in q for q in qs)


def test_a_site_must_be_about_the_niche_to_match_it():
    from app.services import publish_discovery as pd
    b, a = _rental_shop()
    niche = pd.Niche(b, a)
    rental = niche.read("Lehenga on rent in Pune | Bridal outfit rental guide. Hire designer dresses for weddings.")
    fashion = niche.read("Vogue India: fashion news, celebrity style and runway reports. Dresses, outfits and trends.")
    startup = niche.read("Inc42: startup funding news, fintech, SaaS and unicorn reports from India's tech ecosystem.")
    assert "rental cloths" in rental["topics"] and rental["relevance"] > fashion["relevance"] > startup["relevance"] == 0
    assert "rental cloths" not in fashion["topics"] and not startup["topics"]  # a general fashion or business site is not "rental cloths"
    assert "rental" in rental["match"]


def test_ai_suggestions_are_kept_only_when_they_are_about_the_niche(client, monkeypatch):
    from app.services import publish_discovery as pd
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    b, _ = _rental_shop()
    b.description = "We rent lehengas and sherwanis."
    monkeypatch.setattr(ai, "complete_json", lambda s, u, **k: {"sites": [
        {"domain": "weddingblog.example", "name": "Wedding Blog", "page": "https://weddingblog.example/", "topic": "rental cloths", "fit": 5},
        {"domain": "bigmagazine.example", "name": "Big Magazine", "page": "https://bigmagazine.example/", "topic": "rental cloths", "fit": 3},
        {"domain": "startups.example", "name": "Startups", "page": "https://startups.example/", "topic": "rental cloths", "fit": 5},
        {"domain": "norating.example", "name": "No rating", "page": "https://norating.example/", "topic": "rental cloths"}]})
    got = pd._ai_sites(b, pd.topics_of(b, None))
    assert [s["domain"] for s in got] == ["weddingblog.example", "startups.example", "norating.example"]  # the AI's own "general site" rating (3) drops one
    pages = {"https://weddingblog.example/": "<html><head><title>Lehenga on rent</title></head><body><h1>Bridal outfit rental</h1></body></html>",
             "https://startups.example/": "<html><head><title>Startup funding news</title></head><body><h1>Fintech unicorns</h1></body></html>",
             "https://norating.example/": "<html><body><h1>Dress hire for weddings</h1></body></html>"}
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, pages[url], url, 5, None) if url in pages else (404, "", url, 5, "missing"))
    niche = pd.Niche(b, None)
    checked = [pd.verify({"domain": s["domain"], "site": s["name"], "platform": "Website / industry blog", "title": s["name"], "url": s["page"], "snippet": "",
                          "found_by": ["AI suggestion"], "topics": [s["topic"]], "fit": s["fit"]}, niche) for s in got]
    kept = pd._relevant(checked, "ai")
    assert [i["domain"] for i in kept] == ["weddingblog.example", "norating.example"]  # the startup site's pages are not about clothes or renting
    assert "rental cloths" in kept[0]["topics"] and "rental" in kept[0]["match"]  # the topic filter now lists only sites whose pages cover that topic


def test_a_publishing_site_shows_the_platform_it_is_built_on(monkeypatch):
    from app.services import publish_discovery as pd
    wp = ('<html><head><meta name="generator" content="WordPress 6.5.2"><link rel="stylesheet" href="/wp-content/themes/x/s.css"></head>'
          '<body><a href="/advertise">Advertise with us</a></body></html>')
    plain = "<html><body><h1>Our blog</h1><p>Short page.</p></body></html>"
    pages = {"https://wp.example/blog/": wp, "https://plain.example/blog/": plain}
    monkeypatch.setattr(bc, "_fetch", lambda url: (200, pages[url], url, 5, None) if url in pages else (404, "", url, 5, "missing"))
    item = lambda d, p="Website / industry blog": {"domain": d, "site": d, "platform": p, "title": d, "url": f"https://{d}/blog/", "snippet": "", "found_by": ["AI suggestion"], "topics": []}  # noqa: E731
    out = pd.verify(item("wp.example"))
    assert out["cms"]["name"] == "WordPress" and out["cms"]["confidence"] in ("high", "medium") and out["cms"]["evidence"]
    assert pd.verify(item("plain.example"))["cms"] is None  # no signs, so it is not called anything
    assert pd.verify(item("medium.com", "Medium"))["cms"] is None  # an open platform is already named by its platform


def test_article_addresses_are_told_apart_from_home_and_category_pages():
    assert blog_promo._is_article("https://r.example/blog/how-to-choose")
    assert blog_promo._is_article("https://r.example/2025/04/new-clinic")
    assert blog_promo._is_article("https://r.example/best-dental-implants-in-pune")
    assert not blog_promo._is_article("https://r.example/")
    assert not blog_promo._is_article("https://r.example/contact")
    assert not blog_promo._is_article("https://r.example/blog/category/news")
    assert not blog_promo._is_article("https://r.example/tag/modular-kitchen-near-me/page/2")
    assert not blog_promo._is_article("https://store.r.example/products/3-in-1-emergency-mini-safety-hammer")
    assert blog_promo._own_site("https://itimpactdealstore.myshopify.com/products/x", "itimpactdeal.in")
    assert not blog_promo._own_site("https://dentalforum.example/t/1", "rival.example")


def test_another_projects_article_is_not_reachable(client, biz):
    bid, db = biz
    other = client.post("/api/v1/businesses", json={"name": "Other"}).json()["id"]
    a = _article(db, bid)
    assert client.get(f"/api/v1/businesses/{other}/blog-flow/promo/{a.id}").status_code == 404
