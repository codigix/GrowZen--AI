"""The article previewed inside the website's own blog pages: found content area, title, picture and date set, scripts gone, keywords coloured, and clear errors (pages are fakes)."""
import pytest
from bs4 import BeautifulSoup

from app.models import Article
from app.services import site_preview as sp

BODY = ("<h1>Teeth Whitening Pune: A Guide</h1>"
        "<p>Teeth whitening pune is popular because it brightens a smile in one visit without any pain at all for most people.</p>"
        "<h2>Cost</h2><p>This paragraph has no keyword at all but it is long enough to count as a paragraph in the article.</p>"
        "<p>Whitening cost depends on the method, and a short consultation explains every option clearly to each patient.</p><script>steal()</script>")

LIST_PAGE = """<html><head><title>Blog</title><link rel="stylesheet" href="/theme.css"><script>track()</script></head><body onload="x()">
<header><nav>Menu</nav></header><main>
<article class="post post-1 category-news"><a href="/old-one/"><img src="/o1.jpg" srcset="/o1-2x.jpg 2x"></a><h2><a href="/old-one/">Old post one</a></h2><p>An old excerpt that is quite long.</p><time>May 1, 2025</time></article>
<article class="post post-2"><a href="/old-two/"><img src="/o2.jpg"></a><h2><a href="/old-two/">Old post two</a></h2><p>Another old excerpt that is long enough.</p><time>May 2, 2025</time></article>
<article class="post post-3"><h2><a href="/old-three/">Old post three</a></h2><p>Third old excerpt that is long enough too.</p></article>
</main><footer>Footer text</footer></body></html>"""

POST_PAGE = """<html><head><link rel="stylesheet" href="/theme.css"><script>track()</script></head><body>
<header><nav>Menu</nav></header>
<article><h1 class="entry-title">Old title</h1><img class="wp-post-image" src="/old.jpg" srcset="/old-2x.jpg 2x"><time>May 1, 2025</time>
<div class="entry-content"><p>""" + "Old article text that should be replaced. " * 20 + """</p></div></article>
<footer>Footer text</footer></body></html>"""

ELEMENTOR_POST = """<html><head><link rel="stylesheet" href="/e.css"></head><body><header><nav>Menu</nav></header>
<div data-elementor-type="wp-post" class="elementor elementor-9"><section class="elementor-section"><div class="elementor-widget elementor-widget-theme-post-title" data-widget_type="theme-post-title.default"><div class="elementor-widget-container"><h1 class="elementor-heading-title">Old title</h1></div></div>
<div class="elementor-widget elementor-widget-theme-post-featured-image" data-widget_type="theme-post-featured-image.default"><div class="elementor-widget-container"><img src="/old.jpg"></div></div>
<div class="elementor-widget elementor-widget-post-info" data-widget_type="post-info.default"><span class="elementor-post-info__item--type-date"><time>May 1, 2025</time></span></div></section>
<section class="elementor-section"><div class="elementor-widget elementor-widget-text-editor" data-widget_type="text-editor.default"><div class="elementor-widget-container"><p>Old paragraph one that will go.</p></div></div>
<div class="elementor-widget elementor-widget-heading" data-widget_type="heading.default"><h2>Old heading</h2></div>
<div class="elementor-widget elementor-widget-text-editor" data-widget_type="text-editor.default"><div class="elementor-widget-container"><p>Old paragraph two that will go.</p></div></div></section>
<section class="elementor-section"><div class="elementor-widget elementor-widget-nested-accordion" data-widget_type="nested-accordion.default">Old FAQ</div></section></div>
<footer><div class="elementor-widget elementor-widget-text-editor" data-widget_type="text-editor.default"><div class="elementor-widget-container"><p>Footer contact text</p></div></div></footer></body></html>"""


def soup_of(html):
    return BeautifulSoup(html, "html.parser")


def test_keywords_are_coloured_in_text_only_and_a_paragraph_without_one_is_flagged():
    out = soup_of(sp.mark_keywords('<p>Teeth whitening pune today. <a href="/teeth-whitening-pune" title="teeth whitening pune">x</a></p><p>Whitening cost here and the Unwhitening word stays.</p><p>No keyword in this long enough paragraph of text.</p>', "teeth whitening pune", ["whitening cost"]))
    assert [(m["data-kw"], m.get_text()) for m in out.find_all("mark")] == [("primary", "Teeth whitening pune"), ("secondary", "Whitening cost")]
    assert out.find("a")["href"] == "/teeth-whitening-pune" and out.find("a")["title"] == "teeth whitening pune"
    third = out.find_all("p")[2]
    assert "No keyword in this paragraph" in third["title"] and "border-left" in third["style"] and "style" not in out.find_all("p")[0].attrs


def test_the_post_goes_into_the_sites_content_area_with_its_title_picture_and_date(monkeypatch):
    html = sp.render_post(POST_PAGE, "https://site.example/old-post/", title="My New Title", body_html=sp.article_html(BODY, drop_h1=True), image="https://site.example/new.jpg", notes=[])
    s = soup_of(html)
    assert s.select_one("h1.entry-title").get_text() == "My New Title" and s.select_one("img.wp-post-image")["src"] == "https://site.example/new.jpg" and "srcset" not in s.select_one("img.wp-post-image").attrs
    content = s.select_one(".entry-content")
    assert "Old article text" not in content.get_text() and "Teeth whitening pune is popular" in content.get_text() and content.find("h1") is None  # the theme shows the title: the body's own h1 is dropped
    assert s.find("time").get_text() != "May 1, 2025" and s.find("base")["href"] == "https://site.example/old-post/" and not s.find_all("script") and "onload" not in str(s.body.attrs)
    assert s.find("header") and s.find("footer") and s.find("link", rel="stylesheet")  # the site's own design is kept
    assert "steal()" not in html


def test_an_elementor_post_keeps_its_title_picture_and_date_and_swaps_the_old_body():
    html = sp.render_post(ELEMENTOR_POST, "https://site.example/p/", title="New Elementor Title", body_html=sp.article_html(BODY, drop_h1=True), image=None, notes=[])
    s = soup_of(html)
    assert s.select_one(".elementor-widget-theme-post-title h1").get_text() == "New Elementor Title"
    assert "Old paragraph" not in s.get_text() and "Old heading" not in s.get_text() and "Old FAQ" not in s.get_text()
    widgets = s.select(".elementor-widget-text-editor")
    assert len(widgets) == 2 and "Teeth whitening pune is popular" in widgets[0].get_text() and "Footer contact text" in widgets[1].get_text()  # ours, and the footer's own, untouched
    assert s.select_one(".elementor-widget-theme-post-featured-image img") is not None
    assert s.select_one(".elementor-post-info__item--type-date time").get_text() != "May 1, 2025"


def test_a_page_without_a_known_content_class_still_gets_the_article_between_header_and_footer():
    bare = "<html><head></head><body><header>Top</header><div class='x'>Old stuff</div><div class='y'>More old stuff</div><footer>Bottom</footer></body></html>"
    s = soup_of(sp.render_post(bare, "https://site.example/p/", title="T", body_html="<p>The new article text is here for you to read.</p>", image=None, notes=[]))
    assert s.find("header").get_text() == "Top" and s.find("footer").get_text() == "Bottom" and "Old stuff" not in s.get_text() and "new article text" in s.find("main").get_text()


def test_the_list_gets_the_article_as_the_newest_card_in_the_sites_own_card_design():
    html = sp.render_list(LIST_PAGE, "https://site.example/blog/", title="Brand New Post", excerpt="The excerpt of the new post that is long enough.", image="https://site.example/n.jpg", url="https://site.example/blog/new-post/", notes=[])
    s = soup_of(html)
    cards = s.select("article.post")
    assert len(cards) == 4 and "Brand New Post" in cards[0].get_text() and "Old post one" in cards[1].get_text()
    first = cards[0]
    assert all(a["href"] == "https://site.example/blog/new-post/" for a in first.find_all("a")) and first.find("img")["src"] == "https://site.example/n.jpg" and "srcset" not in first.find("img").attrs
    assert "excerpt of the new post" in first.get_text() and "Your new post" in first.get_text() and "post-1" not in first["class"] and "post" in first["class"]
    assert not s.find_all("script") and s.find("header") and s.find("footer")


def test_build_reads_the_sites_pages_and_says_why_when_it_cannot(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Prev Co", "website": "https://site.example/"}).json()["id"]
    pages = {"https://site.example/blog/": LIST_PAGE, "https://site.example/old-one/": POST_PAGE}
    monkeypatch.setattr(sp.bc, "_fetch", lambda url: (200, pages[url], url, 5, None) if url in pages else (404, "", url, 5, None))
    monkeypatch.setattr("app.services.sitemap.discover_site_entries", lambda *a, **k: [])
    sp._cache.clear()
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword="teeth whitening pune", secondary_keywords=["whitening cost"], title="Teeth Whitening Pune: A Guide", status="completed", body=BODY, meta_description="A guide.")
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()
    r = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post", "keyword": "teeth whitening pune", "secondary_keywords": ["whitening cost"]})
    assert r.status_code == 200 and r.json()["reference_url"] == "https://site.example/old-one/" and "Teeth whitening pune" in r.json()["html"] and 'data-kw="primary"' in r.json()["html"]
    lst = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "list", "slug": "My Slug!"}).json()
    assert 'href="https://site.example/blog/my-slug/"' in lst["html"] and lst["view"] == "list"
    off = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post", "highlight": False}).json()["html"]
    assert "<mark" not in off
    sp._cache.clear()
    monkeypatch.setattr(sp.bc, "_fetch", lambda url: (200, "<html><body><div id='root'></div></body></html>", url, 5, None))  # a page the browser builds with JavaScript
    e = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post"})
    assert e.status_code == 422 and "JavaScript" in e.json()["detail"]
