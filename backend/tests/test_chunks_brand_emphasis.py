"""Short chunks, the brand name, and keywords that are bold and highlighted on the website itself (the markup survives saving, the WordPress cleaner and publishing)."""
import json
import re

from app.models import Article
from app.services import articles as svc
from app.services import elementor_layout as lay


class Biz:
    def __init__(self, name):
        self.name = name


def test_the_brand_is_the_short_name_readers_know():
    assert svc.brand_of(Biz("Codigix Infotech Pvt. Ltd. – Healthcare Marketing Agency")) == "Codigix Infotech"
    assert svc.brand_of(Biz("CASA Royale - Luxury PG | Co-living Space | Hinjewadi | Marunji")) == "CASA Royale"
    assert svc.brand_of(Biz("Impression Makeup Studio, Salon And International Academy")) == "Impression Makeup Studio"
    assert svc.brand_of(Biz("Acme")) == "Acme" and svc.brand_of(Biz("Smith & Sons Pvt Ltd")) == "Smith & Sons"


BODY = ('<h1>Teeth Whitening Pune at Acme</h1><p>Teeth whitening pune at Acme Clinic is popular. We explain whitening cost. <a href="/x">teeth whitening pune link</a></p>'
        '<script type="application/ld+json">{"keywords":["teeth whitening pune"]}</script><h2>Cost of teeth whitening pune</h2><p>Plain text only.</p><ul><li>Acme Clinic is local</li></ul>')
PRIMARY_MARK = '<strong data-gz="primary">'


def test_keywords_and_brand_are_bold_and_highlighted_in_the_text_only():
    out = svc.emphasize(BODY, "teeth whitening pune", ["whitening cost"], "Acme Clinic")
    assert out.count('data-gz="primary"') == 1 and out.count('data-gz="secondary"') == 1 and out.count('data-gz="brand"') == 2  # the list item counts too
    assert PRIMARY_MARK + "Teeth whitening pune</strong>" in out and "<mark" not in out and "background" not in out  # bold only, no colour
    assert "<h1>Teeth Whitening Pune at Acme</h1>" in out and "<h2>Cost of teeth whitening pune</h2>" in out  # headings are bold already
    assert '<a href="/x">teeth whitening pune link</a>' in out and '{"keywords":["teeth whitening pune"]}' in out  # links and the schema are left alone
    assert svc.emphasize(out, "teeth whitening pune", ["whitening cost"], "Acme Clinic") == out  # again: nothing doubled
    assert svc.strip_emphasis(out) == BODY
    changed = svc.emphasize(out, "plain text", [], None)  # a changed keyword leaves no old mark behind
    assert 'data-gz="secondary"' not in changed and 'data-gz="brand"' not in changed and changed.count('data-gz="primary"') == 1
    assert svc.emphasize(BODY, "", [], None) == BODY


def _article(client, name="Acme Dental Pvt. Ltd. - Pune", body="<p>x</p>"):
    bid = client.post("/api/v1/businesses", json={"name": name, "website": "https://acme.example/"}).json()["id"]
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword="teeth whitening pune", secondary_keywords=["whitening cost"], title="T", status="completed", body=body)
        db.add(a)
        db.commit()
        return bid, a.id
    finally:
        db.close()


def test_saving_keeps_the_marks_for_the_current_keywords_and_never_leaks_the_schema_placeholder(client):
    bid, aid = _article(client)
    url = f"/api/v1/businesses/{bid}/articles/{aid}"
    body = client.patch(url, json={"body": BODY.replace("Acme Clinic", "Acme Dental")}).json()["body"]
    assert "SCHEMA_PLACEHOLDER" not in body and body.count("application/ld+json") == 1  # an old bug: every save left this text in the article
    assert 'data-gz="primary"' in body and 'data-gz="secondary"' in body and body.count('data-gz="brand"') == 2  # the brand is "Acme Dental", not the whole legal name
    again = client.patch(url, json={"body": body}).json()["body"]
    assert again.count('data-gz="primary"') == body.count('data-gz="primary"') and PRIMARY_MARK + "<strong" not in again  # no nesting
    new_kw = client.patch(url, json={"keyword": "whitening cost", "secondary_keywords": []}).json()["body"]
    assert 'data-gz="primary"' in new_kw and 'data-gz="secondary"' not in new_kw
    w = client.patch(url, json={"body": "<h1>T</h1><p>A paragraph about whitening cost with enough words in it to count as a real paragraph.</p>"}).json()["warnings"]
    assert any("brand name 'Acme Dental'" in x for x in w)


def test_the_wordpress_cleaner_keeps_the_marks_style_but_not_other_inline_styles():
    html = lay.clean_body(svc.emphasize('<h1>T</h1><p style="color:red" class="x">Teeth whitening pune is here.</p>', "teeth whitening pune", [], None))
    assert 'style="color:red"' not in html and 'class="x"' not in html
    assert '<strong data-gz="primary">Teeth whitening pune</strong>' in html and "background" not in html
    legacy = '<p><mark data-gz="primary" style="background:#fde68a"><strong>Teeth whitening pune</strong></mark> is here.</p>'
    assert svc.strip_emphasis(legacy) == "<p>Teeth whitening pune is here.</p>"  # an article saved with the old coloured marks is cleaned


LONG = ("<p>Teeth whitening is a popular cosmetic treatment in Pune. It brightens the shade of your teeth in a single visit. The dentist first cleans the surface carefully. "
        "Then a gel is applied and a light speeds up the process. Most people notice a clear difference straight away. Aftercare is simple and takes only a few minutes each day. "
        "Dr. Mehta advises avoiding dark drinks for two days. Brushing gently with a soft brush keeps the result looking fresh for longer.</p>"
        "<p>Short one that stays as it is, with enough words here.</p>")


def test_long_paragraphs_become_short_chunks_of_whole_sentences():
    out, n = svc.chunk_paragraphs(LONG)
    paras = re.findall(r"<p[^>]*>.*?</p>", out)
    assert n == 1 and len(paras) >= 3 and paras[-1] == "<p>Short one that stays as it is, with enough words here.</p>"
    assert all(8 <= len(svc._text(p).split()) <= 70 for p in paras[:-1]) and all(svc._text(p).rstrip().endswith((".", "!", "?")) for p in paras)
    assert "Dr. Mehta advises" in out and not any(svc._text(p).endswith("Dr.") for p in paras)  # "Dr." is not the end of a sentence
    assert svc.chunk_paragraphs(out)[1] == 0 and svc.long_paragraphs(LONG) == 1 and svc.long_paragraphs(out) == 0


def test_a_paragraph_that_cannot_be_cut_cleanly_is_left_alone():
    one = "<p>" + "A single very long sentence without any full stop inside it that keeps going and going " * 8 + ".</p>"
    assert svc.chunk_paragraphs(one) == (one, 0)
    tagged = "<p>First <strong>bold phrase. Second sentence</strong> ends here now. " + "More words to make this paragraph clearly longer than the limit of sixty words. " * 3 + "Last one.</p>"
    out, _ = svc.chunk_paragraphs(tagged)
    assert all(p.count("<strong>") == p.count("</strong>") for p in re.findall(r"<p[^>]*>.*?</p>", out))  # never a bold tag left open in one chunk


def test_the_brand_is_asked_for_when_it_is_missing_and_left_alone_when_it_is_there(monkeypatch):
    paras = "".join(f"<p>Paragraph number {i} talks about teeth whitening and what patients can expect during a visit to the clinic today.</p>" for i in range(1, 9))
    asked = []

    def fake(prompt, num_predict, timeout=None):
        asked.append(prompt)
        items = json.loads(prompt.split("Paragraphs: ")[1].split("\nAnswer with")[0])
        return {"paragraphs": [{"n": x["n"], "text": x["paragraph"].replace("talks about", "from Acme Clinic talks about")} for x in items]}

    monkeypatch.setattr(svc, "_json", fake)
    out, n = svc.ensure_brand(paras, "Acme Clinic", "teeth whitening")
    assert n == 3 and out.count("Acme Clinic") == 3 and len(asked) == 1
    again, n2 = svc.ensure_brand(out, "Acme Clinic", "teeth whitening")
    assert n2 == 0 and again == out and len(asked) == 1  # three mentions are enough


def test_publishing_makes_sure_the_marks_are_in_what_is_sent(client):
    from app.db import SessionLocal
    from app.models import Business
    from app.services import article_publishing as ap
    bid, aid = _article(client, "Acme Dental", "<p>Teeth whitening pune from Acme Dental explains whitening cost.</p>")
    db = SessionLocal()
    try:
        a = db.get(Article, aid)
        ap.ensure_emphasis(db, a)  # an article saved before this existed
        assert a.body.count("<strong data-gz") == 3 and 'data-gz="brand"' in a.body
        before = a.body
        ap.ensure_emphasis(db, a, db.get(Business, bid))
        assert a.body == before
    finally:
        db.close()


def test_the_editor_can_break_a_draft_into_chunks_without_saving(client):
    bid, aid = _article(client, "Chunk Co", "<p>placeholder paragraph with enough words in it to count here.</p>")
    r = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/chunk-paragraphs", json={"body": LONG, "keyword": "teeth whitening"}).json()
    assert r["split"] == 1 and r["long_left"] == 0 and r["body"].count("<p>") >= 3 and 'data-gz="primary"' in r["body"]
    assert client.get(f"/api/v1/businesses/{bid}/articles/{aid}").json()["body"].startswith("<p>placeholder")


def test_a_section_is_rendered_as_small_pieces_with_lists_and_takeaways():
    d = {"lead": "Teeth whitening is a safe way to brighten your smile at the clinic.",
         "groups": [{"heading": "How the treatment works", "text": "The dentist cleans your teeth first. Then a gel is applied under a light.",
                     "points": ["**Cleaning** removes surface stains first", "A whitening gel is applied carefully", "x"], "steps": True},
                    {"heading": "", "text": "dropped because it has no heading", "points": []}],
         "takeaways": ["Whitening is quick and comfortable", "Aftercare is simple"]}
    out = svc.render_structured(d)
    assert out.count("<h3>") == 1 and "<ol>" in out and out.count("<li>") == 4 and "<strong>Key takeaways</strong>" in out
    assert "**" not in out and "<li>x</li>" not in out and out.startswith("<p>Teeth whitening")
    assert svc.render_structured({}) == ""
