"""A keyword in every paragraph: the check, the rewrite pass (kept only when it is faithful), the endpoint, and the rule given to the writer."""
import pytest

from app.models import Article
from app.services import articles as svc

BODY = ("<h1>Teeth Whitening Pune guide</h1>"
        "<p>Teeth whitening pune is popular because it brightens a smile in one visit without any pain at all for most people.</p>"
        "<h2>How it works</h2>"
        "<p>The dentist cleans the surface, applies a gel and uses a light to speed the process up over about forty five minutes.</p>"
        "<p>Whitening cost depends on the method chosen, and a short consultation explains every option clearly to each patient.</p>"
        "<p>Aftercare is simple: avoid dark drinks for two days and brush gently with a soft brush every morning and night.</p>"
        '<script type="application/ld+json">{"@type":"BlogPosting","keywords":["teeth whitening pune"]}</script>')


def test_coverage_names_the_paragraphs_without_a_keyword():
    c = svc.paragraph_coverage(BODY, "teeth whitening pune", ["whitening cost"])
    assert c["total"] == 4 and c["covered"] == 2 and c["missing"] == [2, 4]
    assert c["paragraphs"][0]["keywords"] == ["teeth whitening pune"] and c["paragraphs"][2]["keywords"] == ["whitening cost"]
    assert svc.paragraph_coverage("<p>short label</p>", "x y", [])["total"] == 0  # a label is not a paragraph


def test_validate_reports_how_many_paragraphs_have_no_keyword():
    w = svc.validate("Teeth Whitening Pune guide", "m" * 155, BODY, "teeth whitening pune", ["whitening cost"])
    assert any(x.startswith("2 of 4 paragraphs have none of the keywords (paragraph 2, 4)") for x in w)


def _fake(monkeypatch, answers):
    asked = []

    def fake(prompt, num_predict, timeout=None):
        asked.append(prompt)
        return answers(prompt) if callable(answers) else answers
    monkeypatch.setattr(svc, "_json", fake)
    return asked


def test_the_rewrite_gives_each_missing_paragraph_a_keyword_and_hands_them_out_evenly(monkeypatch):
    asked = _fake(monkeypatch, {"paragraphs": [
        {"n": 2, "text": "For teeth whitening pune patients, the dentist cleans the surface, applies a gel and uses a light to speed the process up over about forty five minutes."},
        {"n": 4, "text": "Aftercare for whitening cost conscious patients is simple: avoid dark drinks for two days and brush gently with a soft brush every morning and night."}]})
    out, rep = svc.add_keywords_to_paragraphs(BODY, "teeth whitening pune", ["whitening cost"], "teeth whitening")
    assert rep == {"changed": 2, "left": 0, "total": 4}
    cov = svc.paragraph_coverage(out, "teeth whitening pune", ["whitening cost"])
    assert cov["missing"] == [] and "application/ld+json" in out and out.count("<h2>") == 1
    import json
    items = json.loads(asked[0].split("Paragraphs: ")[1].split("\nAnswer with")[0])
    assert [x["keyword"] for x in items] == ["teeth whitening pune", "whitening cost"]  # each had one paragraph; the two free paragraphs take one each, not both the same


def test_an_unfaithful_rewrite_is_left_out(monkeypatch):
    _fake(monkeypatch, {"paragraphs": [
        {"n": 2, "text": "Teeth whitening pune now costs 4999 rupees and is guaranteed to last ten years for every patient who visits the clinic this month alone."},  # a number that was not there
        {"n": 4, "text": "Aftercare."}]})  # far too short, and no keyword
    out, rep = svc.add_keywords_to_paragraphs(BODY, "teeth whitening pune", ["whitening cost"])
    assert out == BODY and rep == {"changed": 0, "left": 2, "total": 4}


def test_nothing_is_asked_when_every_paragraph_has_a_keyword(monkeypatch):
    asked = _fake(monkeypatch, {})
    full = "<p>Teeth whitening pune is popular because it brightens a smile in one visit without any pain at all for most people.</p>"
    out, rep = svc.add_keywords_to_paragraphs(full, "teeth whitening pune", [])
    assert out == full and rep["changed"] == 0 and asked == []


def test_the_editor_can_ask_for_it_on_the_unsaved_draft(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Kw Co", "website": "https://kw.example/"}).json()["id"]
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword="teeth whitening pune", secondary_keywords=["whitening cost"], title="T", status="completed", body="<p>placeholder paragraph with enough words in it to count here.</p>")
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()
    _fake(monkeypatch, {"paragraphs": [{"n": 2, "text": "For teeth whitening pune patients, the dentist cleans the surface, applies a gel and uses a light to speed the process up over about forty five minutes."},
                                       {"n": 4, "text": "Aftercare for whitening cost conscious patients is simple: avoid dark drinks for two days and brush gently with a soft brush every morning and night."}]})
    r = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/keyword-paragraphs", json={"body": BODY}).json()
    assert r["changed"] == 2 and r["missing_after"] == 0 and r["covered"] == 4 and "for teeth whitening pune patients" in r["body"].lower()
    assert client.get(f"/api/v1/businesses/{bid}/articles/{aid}").json()["body"].startswith("<p>placeholder")  # nothing was saved


def test_the_writer_is_told_to_put_a_keyword_in_every_paragraph(monkeypatch):
    from app.models import Business as Biz
    streamed = []
    monkeypatch.setattr(svc, "_json", lambda prompt, num_predict, timeout=None: {"title": "Teeth Whitening Pune: What To Know", "meta": "m" * 155, "faqs": []})
    monkeypatch.setattr(svc, "_write_paragraphs", lambda prompt, *a, **k: (streamed.append(prompt) or "A teeth whitening pune paragraph that is long enough to be kept as text here for the reader. " * 3))
    svc.write("teeth whitening pune", ["whitening cost"], [], Biz(name="Acme", city="Pune"), topic="teeth whitening", length="short")
    assert streamed and all("Every paragraph must naturally contain at least one of these exact keyword phrases" in p and '"whitening cost"' in p and '"teeth whitening pune"' in p for p in streamed)
