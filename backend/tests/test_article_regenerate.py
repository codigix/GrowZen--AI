"""Regenerate Content: each option changes only its part, keeps headings/lists/CTA/schema, saves nothing, and refuses
duplicate requests. Claude is simulated (no network)."""
import pytest

from app.db import SessionLocal
from app.models import Article, Business
from app.services import articles as svc

SCHEMA = '<script type="application/ld+json">{"@context": "https://schema.org"}</script>'
BODY = "\n\n".join([
    "<h1>Software Engineer: Role, Skills and Career Path</h1>",
    "<p>Old intro one about software engineer careers.</p>\n<p>Old intro two.</p>",
    "<h2>What a Software Engineer Does</h2>\n<p>Old section one A with software engineer skills.</p>\n<h3>Daily Work</h3>\n<p>Old daily work.</p>\n<ul><li>Code</li><li>Review</li></ul>",
    "<h2>How to Become One</h2>\n<p>Old become one.</p>",
    "<h2>Frequently Asked Questions</h2>\n<h3>Old question one?</h3>\n<p>Old answer one.</p>\n<h3>Old question two?</h3>\n<p>Old answer two.</p>\n<h3>Old question three?</h3>\n<p>Old answer three.</p>",
    '<h2>Ready to Get Started? Contact Acme Today</h2>\n<div class="blog-cta-box">\n  <p>Old CTA paragraph.</p>\n  <ul><li><strong>Phone:</strong> <a href="tel:123">123</a></li></ul>\n</div>',
    SCHEMA,
])


@pytest.fixture()
def art(client):
    bid = client.post("/api/v1/businesses", json={"name": "Acme", "website": "https://acme.com", "primary_category": "IT"}).json()["id"]
    s = SessionLocal()
    a = Article(business_id=bid, keyword="software engineer", secondary_keywords=["software engineer skills"], title="Software Engineer: Role, Skills and Career Path",
                meta_description="Meta.", body=BODY, status="completed", topic="software engineer", length="short", featured_image_alt="ALT")
    s.add(a)
    s.commit()
    yield bid, a.id, s
    s.rollback()
    s.query(Article).filter(Article.id == a.id).delete()
    s.query(Business).filter(Business.id == bid).delete()  # leave no extra businesses behind for other tests
    s.commit()
    s.close()


def _fake_json(monkeypatch, answer):
    prompts = []

    def fake(prompt, num_predict, timeout=None):
        prompts.append(prompt)
        return answer(prompt) if callable(answer) else answer
    monkeypatch.setattr(svc, "_json", fake)
    return prompts


def _post(client, bid, aid, **body):
    return client.post(f"/api/v1/businesses/{bid}/articles/{aid}/regenerate", json=body)


def test_sections_lists_h2_and_h3_but_not_the_faq_block(client, art):
    bid, aid, _ = art
    secs = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/regenerate/sections", json={}).json()["sections"]
    assert [(x["id"], x["level"], x["heading"]) for x in secs] == [
        ("s0", 2, "What a Software Engineer Does"), ("s0.0", 3, "Daily Work"), ("s1", 2, "How to Become One"), ("s3", 2, "Ready to Get Started? Contact Acme Today")]


def test_intro_changes_only_the_intro_paragraphs_and_nothing_is_saved(client, art, monkeypatch):
    bid, aid, s = art
    prompts = _fake_json(monkeypatch, {"paragraphs": ["New intro one about software engineer.", "New intro two."]})
    r = _post(client, bid, aid, part="intro").json()
    assert r["label"] == "Introduction" and "Old intro one" in r["current_html"] and "New intro one" in r["new_html"]
    assert r["body"] == BODY.replace("Old intro one about software engineer careers.", "New intro one about software engineer.").replace("Old intro two.", "New intro two.")
    assert 'first sentence must contain the exact phrase "software engineer"' in prompts[0]  # the writer's intro rule
    assert "Old intro one about software engineer careers." in prompts[0]  # it sees the current text it replaces
    s.expire_all()
    assert s.get(Article, aid).body == BODY  # nothing saved until the user accepts and saves


def test_a_section_keeps_its_heading_sub_heading_and_list(client, art, monkeypatch):
    bid, aid, _ = art
    prompts = _fake_json(monkeypatch, {"paragraphs": ["New A uses software engineer skills.", "New daily."]})
    r = _post(client, bid, aid, part="section", section_id="s0").json()
    assert r["label"] == "What a Software Engineer Does"
    assert "<h3>Daily Work</h3>" in r["new_html"] and "<ul><li>Code</li><li>Review</li></ul>" in r["new_html"] and "New daily." in r["new_html"]
    assert r["body"].count("Old") == BODY.count("Old") - 2  # only the two paragraphs of that section changed
    assert '"software engineer skills"' in prompts[0]  # the keyword it used must stay
    sub = _post(client, bid, aid, part="section", section_id="s0.0").json()  # an H3 alone
    assert sub["label"] == "Daily Work" and "Old section one A" in sub["body"]


def test_conclusion_keeps_the_cta_box_and_contact_details(client, art, monkeypatch):
    bid, aid, _ = art
    _fake_json(monkeypatch, {"paragraphs": ["New CTA paragraph."]})
    r = _post(client, bid, aid, part="conclusion").json()
    assert r["label"].startswith("Ready to Get Started")
    assert '<div class="blog-cta-box">' in r["new_html"] and '<a href="tel:123">123</a>' in r["new_html"] and "New CTA paragraph." in r["new_html"]
    assert r["body"].endswith(SCHEMA)


def test_faqs_are_replaced_as_a_set_under_the_same_heading(client, art, monkeypatch):
    bid, aid, _ = art
    _fake_json(monkeypatch, {"faqs": [{"question": f"New q {i}", "answer": f"New a {i}."} for i in range(3)]})
    r = _post(client, bid, aid, part="faqs").json()
    assert r["new_html"].startswith("<h2>Frequently Asked Questions</h2>") and r["new_html"].count("<h3>") == 3 and "<h3>New q 0?</h3>" in r["new_html"]
    assert "Old question" not in r["body"] and "Old intro one" in r["body"] and "Old CTA paragraph." in r["body"]


def test_full_article_keeps_the_seo_title_h1(client, art, monkeypatch):
    bid, aid, _ = art
    seen = {}

    def fake_write(*a, **k):
        seen.update(k, primary=a[0], secondary=a[1])
        return {"body": "<h1>A Different Title</h1>\n<p>Fresh intro.</p>\n<h2>Fresh</h2><p>x</p>\n" + SCHEMA}
    monkeypatch.setattr(svc, "write", fake_write)
    r = _post(client, bid, aid, part="full").json()
    assert r["body"].startswith("<h1>Software Engineer: Role, Skills and Career Path</h1>") and "Fresh intro." in r["body"] and r["body"].count("ld+json") == 1
    # a title just regenerated in the editor (not saved yet) leads the new article: the writer plans around it, it is the H1
    r = _post(client, bid, aid, part="full", title="Software Engineer Guide: Duties, Skills and Growth", meta_description="New promise.",
              keyword="software engineer", secondary_keywords=["software engineer salary"]).json()
    assert r["body"].startswith("<h1>Software Engineer Guide: Duties, Skills and Growth</h1>")
    assert seen["title_hint"] == "Software Engineer Guide: Duties, Skills and Growth" and seen["meta_hint"] == "New promise." and seen["secondary"] == ["software engineer salary"]


def test_body_parts_follow_the_editor_title(client, art, monkeypatch):
    bid, aid, _ = art
    prompts = _fake_json(monkeypatch, {"paragraphs": ["New intro about software engineer.", "Two."]})
    _post(client, bid, aid, part="intro", title="Software Engineer Guide: Duties, Skills and Growth")
    assert 'Article SEO title: "Software Engineer Guide: Duties, Skills and Growth"' in prompts[0] and "deliver what the SEO title promises" in prompts[0]


def test_the_writer_keeps_a_given_title(monkeypatch):
    """New articles are unchanged (no hint); with a hint the plan is asked to deliver it and the H1 is that title."""
    from app.models import Business as Biz
    asked = []

    def fake_json(prompt, num_predict, timeout=None):
        asked.append(prompt)
        return {"title": "Something Else Entirely About Software Engineer", "meta": "m" * 155, "faqs": []}
    monkeypatch.setattr(svc, "_json", fake_json)
    monkeypatch.setattr(svc, "_write_paragraphs", lambda *a, **k: "A software engineer paragraph that is long enough to be kept as text here. " * 3)
    biz = Biz(name="Acme", city="Pune")
    plain = svc.write("software engineer", [], [], biz, topic="software engineer", length="short")
    assert "<h1>Something Else Entirely About Software Engineer</h1>" in plain["body"] and "SEO title is fixed" not in asked[0]
    kept = svc.write("software engineer", [], [], biz, topic="software engineer", length="short", title_hint="Software Engineer Guide: Duties, Skills and Growth")
    assert "<h1>Software Engineer Guide: Duties, Skills and Growth</h1>" in kept["body"] and 'SEO title is fixed: "Software Engineer Guide' in asked[-1]


def test_unsaved_editor_text_is_used_and_errors_are_clear(client, art, monkeypatch):
    bid, aid, _ = art
    _fake_json(monkeypatch, {"paragraphs": ["X."]})
    edited = BODY.replace("Old become one.", "My unsaved edit.")
    assert "My unsaved edit." in _post(client, bid, aid, part="intro", body=edited).json()["body"]
    assert _post(client, bid, aid, part="section", section_id="s9").status_code == 422
    assert _post(client, bid, aid, part="section", section_id="s2").status_code == 422  # the FAQ block: use Regenerate FAQs
    _fake_json(monkeypatch, {})
    r = _post(client, bid, aid, part="intro")
    assert r.status_code == 502 and "did not return usable text" in r.json()["detail"]


def _fake_short(monkeypatch, answers):
    prompts = []

    def fake(prompt, num_predict=90, timeout=90):
        prompts.append(prompt)
        return answers.pop(0) if answers else ""
    monkeypatch.setattr(svc, "_short", fake)
    return prompts


def test_seo_title_changes_only_the_title_and_uses_the_unsaved_editor_values(client, art, monkeypatch):
    bid, aid, s = art
    prompts = _fake_short(monkeypatch, [
        "Careers",                                                         # no keyword: rejected
        '"Software Engineer Careers: Skills, Salary & Growth Roadmap"',   # 58 chars, quotes stripped
    ])
    r = _post(client, bid, aid, part="title", title="My unsaved title", meta_description="My unsaved meta.", keyword="software engineer",
              secondary_keywords=["software engineer salary"], body=BODY)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["field"] == "title" and d["value"] == "Software Engineer Careers: Skills, Salary & Growth Roadmap" and 50 <= len(d["value"]) <= 60
    assert d["current"] == "My unsaved title" and "body" not in d  # only this one field comes back
    assert 'Current SEO title: "My unsaved title"' in prompts[0] and '"software engineer salary"' in prompts[0]
    assert "meta description" not in prompts[0].lower().split("write one new")[1]  # it asks for a title only
    s.expire_all()
    a = s.get(Article, aid)
    assert (a.title, a.meta_description, a.body, a.featured_image_alt, a.keyword) == ("Software Engineer: Role, Skills and Career Path", "Meta.", BODY, "ALT", "software engineer")


def test_a_too_long_title_is_shortened_and_a_useless_answer_is_a_clear_error(client, art, monkeypatch):
    bid, aid, _ = art
    _fake_short(monkeypatch, ["Software Engineer Guide: Skills, Salary and Career Path | Complete 2026 Roadmap for Beginners"])
    v = _post(client, bid, aid, part="title").json()["value"]
    assert len(v) <= 60 and "Software Engineer" in v
    _fake_short(monkeypatch, ["", "", ""])
    r = _post(client, bid, aid, part="title")
    assert r.status_code == 502 and "SEO title" in r.json()["detail"]


def test_meta_description_changes_only_the_meta_and_targets_150_to_160(client, art, monkeypatch):
    bid, aid, s = art
    good = ("Learn what a software engineer does, the skills employers want, how to get started and how to grow your career "
            "step by step. Read the full guide today.")
    assert 150 <= len(good) <= 160
    prompts = _fake_short(monkeypatch, ["Too short about software engineer.", good])
    d = _post(client, bid, aid, part="meta", title="My unsaved title", meta_description="Old meta.", keyword="software engineer").json()
    assert d["field"] == "meta_description" and d["value"] == good and d["current"] == "Old meta." and "body" not in d
    assert 'SEO title: "My unsaved title"' in prompts[0] and "150-160 characters" in prompts[0]
    s.expire_all()
    a = s.get(Article, aid)
    assert (a.title, a.meta_description, a.body) == ("Software Engineer: Role, Skills and Career Path", "Meta.", BODY)


def test_a_second_request_for_the_same_article_is_refused_while_one_runs(client, art, monkeypatch):
    bid, aid, _ = art
    seen = {}

    def slow(prompt, num_predict, timeout=None):
        seen["second"] = _post(client, bid, aid, part="faqs").status_code  # arrives while the first is running
        return {"paragraphs": ["Y."]}
    monkeypatch.setattr(svc, "_json", slow)
    assert _post(client, bid, aid, part="intro").status_code == 200 and seen["second"] == 409
    assert _post(client, bid, aid, part="intro").status_code == 200  # released afterwards
