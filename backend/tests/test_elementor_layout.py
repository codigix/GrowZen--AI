"""Publishing into the site's Elementor layout: the article's sections replace the old ones, the FAQ accordion is refilled, and nothing of the old article is kept as if it were layout."""
import copy

from app.services import elementor_layout as lay


def w(kind, **settings):
    return {"id": f"w{abs(hash((kind, str(settings)))) % 99999}", "elType": "widget", "widgetType": kind, "settings": settings, "elements": []}


def box(*kids):
    return {"id": f"c{abs(hash(str(kids))) % 99999}", "elType": "container", "settings": {}, "elements": list(kids)}


def layout(with_button=False):
    column = [w("theme-post-featured-image"), w("heading", title="Old one"), w("text-editor", editor="<p>Old text one</p>"), w("heading", title="Old two"), w("text-editor", editor="<p>Old text two</p>"),
              box(w("heading", title="Old conclusion"), w("text-editor", editor="<p>Old conclusion text</p>"))]  # the reference's own conclusion: a group of nothing but heading and text
    if with_button:
        column.append(box(w("heading", title="Call us"), w("button", text="Contact"), w("text-editor", editor="<p>Our phone</p>")))  # a real call-to-action box
    accordion = {"id": "acc1", "elType": "widget", "widgetType": "nested-accordion", "settings": {"items": [{"item_title": "Old Q", "_id": "i1"}]},
                 "elements": [box(w("text-editor", editor="<p>Old A</p>"))]}
    return [box(w("theme-post-title"), w("post-info")), box(box(*column), box(w("heading", title="Recent Blogs"))), box(w("heading", title="FAQ"), accordion)]


BODY = ("<h1>T</h1><p>The introduction of the new article is here.</p><h2>New section</h2><p>New section text.</p>"
        "<h2>Frequently Asked Questions</h2><h3>How long?</h3><p>A few months.</p><h3>Why?</h3><p>Because.</p><h2>Conclusion</h2><p>The new conclusion text.</p>")


def texts(data):
    out = []
    for n, _ in lay._walk(data):
        s = n.get("settings") or {}
        out.append(s.get("editor") or s.get("title") or "")
    return " ".join(out)


def test_the_article_replaces_the_old_sections_and_the_old_conclusion_group_does_not_survive():
    data, report = lay.build(layout(), article_key="a1", body=BODY)
    t = texts(data)
    assert "New section text" in t and "The new conclusion text" in t and "The introduction of the new article" in t
    assert "Old text" not in t and "Old conclusion" not in t and "Old one" not in t  # the stale conclusion of the reference post is not published again
    assert "Recent Blogs" in t  # the sidebar is layout and stays
    assert report["sections"] == 2 and report["faqs"] == 2  # "New section" and "Conclusion"; the FAQ section went to the accordion


def test_a_box_with_a_button_is_a_call_to_action_and_stays():
    data, _ = lay.build(layout(with_button=True), article_key="a2", body=BODY)
    t = texts(data)
    assert "Call us" in t and "Our phone" in t and "Old conclusion" not in t


def test_the_faq_accordion_gets_this_articles_questions_or_is_dropped_without_any():
    data, _ = lay.build(layout(), article_key="a3", body=BODY)
    acc = next(n for n, _ in lay._walk(data) if n.get("widgetType") == "nested-accordion")
    assert [i["item_title"] for i in acc["settings"]["items"]] == ["How long?", "Why?"] and len(acc["elements"]) == 2
    assert "A few months" in texts(acc["elements"]) and "Old A" not in texts(acc["elements"])
    no_faq = BODY.split("<h2>Frequently")[0]
    data2, report = lay.build(copy.deepcopy(layout()), article_key="a4", body=no_faq)
    assert not any(n.get("widgetType") == "nested-accordion" for n, _ in lay._walk(data2)) and report["faqs"] == 0  # the whole FAQ block goes


def test_the_schema_is_moved_into_the_page_head_by_one_line_script():
    schema = '<script type="application/ld+json">{"@context": "https://schema.org"}</script>'
    out = lay.in_head(schema)
    assert out.count('data-gz-schema="1"') == 1 and "document.head.appendChild" in out and out.index("ld+json") < out.index("appendChild")
    assert lay.in_head(out).count('data-gz-schema="1"') == 1  # again: not marked twice
    assert lay.in_head("<p>no schema</p>") == ""
