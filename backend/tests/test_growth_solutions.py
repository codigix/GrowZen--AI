"""Exact solutions for fix tasks: stack-aware code, structured data from the real profile, sitemap and llms.txt from crawled pages, AI only for wording (offline)."""
import json
from datetime import date

import pytest

from app.db import SessionLocal
from app.models import Business, GrowthAction, Keyword
from app.services import ai, growth_content as gc, growth_solutions as gs

TODAY = date(2026, 11, 13)

REPORT = {"final_url": "https://rental.example/", "tech": {"server": "nginx/1.24.0 (Ubuntu)", "frameworks": ["React", "Vite"], "analytics": ["Google Analytics 4"], "cdn": [],
          "detected": [{"name": "Magento", "via": "file https://other-shop.com/pub/static/x.css"}, {"name": "React", "via": "page code"}]},
          "robots": {"ai_crawlers": [{"bot": "GPTBot", "allowed": False}, {"bot": "ClaudeBot", "allowed": True}]}}


@pytest.fixture
def project(client):
    r = client.post("/api/v1/businesses", json={"name": "Rental Co", "city": "Pune", "website": "https://rental.example", "phone": "+91 98765 43210", "address": "12 MG Road, Pune",
                                                  "description": "We rent designer lehengas for weddings. Fitting included. Delivery in Pune.", "contact_email": "o@rental.example"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def task(db, bid, key, verify=None, why=None, link="/x"):
    a = GrowthAction(business_id=bid, area="seo", key=key, period="fix", due_on=TODAY, title="t", why=why, status="todo", verify=verify or {}, link=link, evidence={"severity": "serious"}, how=["generic step"])
    db.add(a)
    db.flush()
    return a


@pytest.fixture
def site(monkeypatch):
    crawl = {"pages": [{"url": "https://rental.example/", "status": 200, "title": "Rental Co home", "h1": "Designer lehenga rental"}, {"url": "https://rental.example/products", "status": 200, "title": "Products", "h1": ""},
                       {"url": "https://rental.example/secret", "status": 200, "noindex": True, "title": "x"}, {"url": "https://rental.example/gone", "status": 404, "title": "x"}]}
    monkeypatch.setattr(gs, "_context", lambda db, b: (REPORT, crawl))
    return crawl


# ------------------------------------------------------------------------------------------------------------------- the stack
def test_the_stack_ignores_technology_seen_only_in_another_sites_file():
    st = gs.stack_of(REPORT, "https://rental.example")
    assert st["server"] == "nginx" and st["platform"] == "spa" and "Magento" not in st["note"] and "React/Vite" in st["note"]
    assert gs.stack_of({"tech": {"server": "Apache", "detected": [{"name": "WordPress", "via": "meta generator"}]}}, "https://x.in")["platform"] == "wordpress"
    unknown = gs.stack_of(None)
    assert unknown["server"] == "unknown" and "could not be identified" in unknown["note"]


# ------------------------------------------------------------------------------------------------------------------- deterministic solutions
def test_security_headers_come_in_the_servers_own_syntax_and_never_weaken_anything(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        hsts = gs.build(db, b, task(db, project, "fix.security.hsts"))
        assert hsts["blocks"][0]["lang"] == "nginx" and 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' in hsts["blocks"][0]["text"] and len(hsts["blocks"]) == 1
        csp = gs.build(db, b, task(db, project, "fix.security.csp"))
        text = csp["blocks"][0]["text"]
        assert "googletagmanager.com" in text and "unsafe-eval" not in text and "script-src 'self' https://www.googletagmanager.com" in text  # tuned to the detected analytics
        assert any("Report-Only" in s for s in csp["steps"]) and any("unsafe-eval" in s for s in csp["steps"])
        monkey_stack = gs.stack_of({"tech": {"server": "Apache/2.4"}})
        assert gs.headers_solution("fix.security.x_frame_options", monkey_stack)["blocks"][0]["lang"] == "apache"
        unknown = gs.headers_solution("fix.security.x_content_type_options", gs.stack_of(None))
        assert {b["lang"] for b in unknown["blocks"]} >= {"nginx", "apache", "json"}  # every common option when the server is unknown
    finally:
        db.close()


def test_structured_data_is_built_from_the_real_profile_without_invented_facts(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        sol = gs.build(db, b, task(db, project, "fix.chatgpt.jsonld"))
        data = json.loads(sol["blocks"][0]["text"].split(">", 1)[1].rsplit("</script", 1)[0])
        assert data["name"] == "Rental Co" and data["telephone"] == "+91 98765 43210" and data["address"]["streetAddress"] == "12 MG Road, Pune"
        assert "aggregateRating" not in data  # no rating was reported by Google: none is invented
        assert "index.html" in sol["blocks"][0]["where"]  # a single-page app: in the static head
    finally:
        db.close()


def test_robots_sitemap_and_llms_txt_use_what_is_really_there(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        robots = gs.build(db, b, task(db, project, "fix.xray.ai_crawlers"))
        assert "User-agent: GPTBot\nAllow: /" in robots["blocks"][0]["text"] and "ClaudeBot" not in robots["blocks"][0]["text"]  # only the blocked bot
        sm = gs.build(db, b, task(db, project, "fix.site.sitemap.missing"))
        xml = sm["blocks"][0]["text"]
        assert "https://rental.example/products" in xml and "/secret" not in xml and "/gone" not in xml and "Sitemap: https://rental.example/sitemap.xml" in sm["blocks"][1]["text"]
        llms = gs.build(db, b, task(db, project, "fix.xray.llms_txt"))["blocks"][0]["text"]
        assert llms.startswith("# Rental Co") and "> We rent designer lehengas for weddings." in llms and "Fitting included" not in llms  # one sentence, not the whole About text
        assert "Phone: +91 98765 43210" in llms and "secret" not in llms
    finally:
        db.close()


def test_a_sitemap_without_a_crawl_says_what_to_do_first(project, monkeypatch):
    monkeypatch.setattr(gs, "_context", lambda db, b: (None, {}))
    db = SessionLocal()
    try:
        with pytest.raises(gs.SolutionError, match="crawled"):
            gs.build(db, db.get(Business, project), task(db, project, "fix.site.sitemap.missing"))
    finally:
        db.close()


def test_listing_and_accessibility_solutions_carry_the_exact_details(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        listing = gs.build(db, b, task(db, project, "fix.listing.bing.add"))
        assert "Bing Places" in listing["title"] and "Phone: +91 98765 43210" in listing["blocks"][0]["text"] and any("duplicate" in s for s in listing["steps"])
        a11y = gs.build(db, b, task(db, project, "fix.xray.a11y_main"))
        assert "<main>" in a11y["blocks"][0]["text"]
        generic = gs.build(db, b, task(db, project, "fix.rank.maps.something"))
        assert generic["steps"][0] == "generic step"  # tasks with no special builder keep their own steps
        assert gs.build(db, b, task(db, project, "fix.onpage.javascript_only"))["minutes"] >= 60
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- AI-written parts
def fake_ai(monkeypatch, answer):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "complete_json", lambda system, user, **kw: answer)
    monkeypatch.setattr(ai, "profile_text", lambda b: "Rental Co rents designer lehengas in Pune")


def test_unique_titles_are_cut_to_length_and_written_into_head_tags(project, site, monkeypatch):
    fake_ai(monkeypatch, {"pages": [{"path": "/", "title": "Designer lehenga rental in Pune | Rental Co " + "x" * 50, "description": "Rent a designer lehenga. " * 12, "h1": "Lehenga rental in Pune"},
                                    {"path": "/products", "title": "Lehengas to rent | Rental Co", "description": "Browse the collection and book a trial."}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        db.add(Keyword(business_id=project, keyword="lehenga rental in pune", volume=300, tracked=True))
        db.flush()
        sol = gs.build(db, b, task(db, project, "fix.site.meta.title_duplicate", why="Several pages share one title. Pages: /, /products."))
        home = next(x for x in sol["blocks"] if "for /" in x["label"] and "products" not in x["label"])["text"]
        title = home.split("<title>")[1].split("</title>")[0]
        assert len(title) <= 60 and 'rel="canonical" href="https://rental.example/"' in home and "<h1>Lehenga rental in Pune</h1>" in home
        assert any("products" in x["label"] for x in sol["blocks"]) and sol["ai_used"] is True and "index.html" in " ".join(sol["steps"])
    finally:
        db.close()


def test_faq_schema_uses_the_real_faqs_first_and_matches_the_visible_text(project, site, monkeypatch):
    fake_ai(monkeypatch, {"faqs": [{"q": "AI question?", "a": "AI answer."}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        b.faqs = [{"q": "Do you deliver?", "a": "Yes, in Pune."}]
        sol = gs.build(db, b, task(db, project, "fix.xray.faq_schema"))
        visible, ld = sol["blocks"][0]["text"], sol["blocks"][1]["text"]
        assert "Do you deliver?" in visible and "AI question" not in visible  # the owner's own answers win
        assert json.loads(ld.split(">", 1)[1].rsplit("</script", 1)[0])["mainEntity"][0]["name"] == "Do you deliver?"
    finally:
        db.close()


def test_without_ai_the_message_says_what_to_set_up_and_html_is_cleaned(project, site, monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        t = task(db, project, "fix.xray.direct_answer")
        with pytest.raises(gs.SolutionError, match="AI is not set up"):
            gs.build(db, b, t)
        fake_ai(monkeypatch, {"html": "<p>Rental Co rents lehengas.</p><script>alert(1)</script><img src=x onerror=alert(1)>"})
        html = gs.build(db, b, t)["blocks"][0]["text"]
        assert "<p>Rental Co rents lehengas.</p>" in html and "<script" not in html and "<img" not in html and "onerror" not in html
    finally:
        db.close()


# ------------------------------------------------------------------------------------------------------------------- the hand-off brief and the API
def test_the_developer_brief_collects_only_website_side_open_tasks_in_severity_order(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        task(db, project, "fix.security.hsts")
        low = task(db, project, "fix.xray.llms_txt")
        low.evidence = {"severity": "info"}
        task(db, project, "fix.gbp.reviews")  # an in-app task: not for the developer
        verified = task(db, project, "fix.security.x_frame_options")
        verified.status = "verified"
        db.flush()
        out = gs.handoff(db, b)
        md = out["markdown"]
        assert out["count"] == 2 and md.index("Strict-Transport-Security") < md.index("llms.txt") and "Reviews" not in md and "X-Frame-Options" not in md
        assert "```nginx" in md and out["minutes"] == 20
    finally:
        db.close()


def test_the_solution_endpoints_cache_scope_and_explain_failures(client, project, site, monkeypatch):
    db = SessionLocal()
    a = task(db, project, "fix.security.hsts")
    ai_task = task(db, project, "fix.xray.direct_answer")
    db.commit()
    aid, ai_id = a.id, ai_task.id
    db.close()
    r = client.post(f"/api/v1/businesses/{project}/growth/actions/{aid}/solution")
    assert r.status_code == 200 and r.json()["solution"]["blocks"][0]["lang"] == "nginx"
    got = client.get(f"/api/v1/businesses/{project}/growth/actions/{aid}").json()
    assert got["solution"]["title"].startswith("Add the Strict-Transport-Security") and got["website_side"] is True and got["closes_when"]
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    bad = client.post(f"/api/v1/businesses/{project}/growth/actions/{ai_id}/solution")
    assert bad.status_code == 409 and "AI is not set up" in bad.json()["detail"]
    assert client.post(f"/api/v1/businesses/{project}/growth/actions/999999/solution").status_code == 404
    brief = client.get(f"/api/v1/businesses/{project}/growth/handoff").json()
    assert brief["count"] == 1 and "Strict-Transport-Security" in brief["markdown"] and brief["skipped"]


def test_start_builds_every_solution_that_needs_no_ai_and_only_a_few_that_do(project, site, monkeypatch):
    fake_ai(monkeypatch, {"html": "<p>x</p>", "faqs": [{"q": "q?", "a": "a."}], "pages": [{"path": "/", "title": "T", "description": "D"}]})
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        task(db, project, "fix.security.hsts")
        task(db, project, "fix.xray.llms_txt")
        for k in ("fix.xray.direct_answer", "fix.xray.faq_schema", "fix.xray.eeat"):
            task(db, project, k)
        out = gs.prefill(db, b, ai_limit=2)
        assert out["ai"] == 2 and out["built"] == 4  # both free ones, and two of the three AI ones
        assert gs.prefill(db, b, ai_limit=2)["built"] == 1  # a second run only finishes what is left
        monkeypatch.setattr(ai, "is_configured", lambda: False)
        t = task(db, project, "fix.xray.question_headings")
        assert gs.prefill(db, b)["failed"] == 1 and not (t.evidence or {}).get("solution")  # no AI key: reported, nothing invented
    finally:
        db.close()


def test_the_brief_lists_the_same_change_once(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        task(db, project, "fix.xray.author")
        task(db, project, "fix.xray.date")  # both are answered by the same written block (identical solution)
        a1, a2 = (db.query(GrowthAction).filter_by(business_id=project, key=k).one() for k in ("fix.xray.author", "fix.xray.date"))
        same = {"title": "Show who is behind the business", "minutes": 15, "summary": "s", "steps": ["x"], "blocks": [{"label": "L", "where": "w", "lang": "html", "text": "<p>same</p>"}], "check": "c"}
        a1.evidence = {"severity": "info", "solution": same}
        a2.evidence = {"severity": "info", "solution": dict(same)}
        db.flush()
        out = gs.handoff(db, b)
        assert out["count"] == 1 and out["minutes"] == 15 and out["markdown"].count("Show who is behind the business") == 1
    finally:
        db.close()


def test_review_and_photo_solutions_use_the_projects_own_review_link_and_never_gate_or_incentivise(project, site):
    db = SessionLocal()
    try:
        b = db.get(Business, project)
        rev = gs.build(db, b, task(db, project, "fix.gbp.reviews"))
        link = rev["blocks"][-1]["text"]
        assert "/r/" in link and all(link in blk["text"] for blk in rev["blocks"][:3])
        text = " ".join(blk["text"] for blk in rev["blocks"][:3]) + " ".join(rev["steps"])
        assert "happy" not in " ".join(blk["text"] for blk in rev["blocks"][:3]).lower() and "Never offer a discount" in text  # honest feedback from everyone, no incentives
        photos = gs.build(db, b, task(db, project, "fix.gbp.photos"))
        assert "Storefront" in photos["blocks"][0]["text"] and photos["audience"] == "owner"
    finally:
        db.close()
