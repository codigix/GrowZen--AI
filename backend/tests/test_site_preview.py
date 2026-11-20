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

def _w(kind, inner, extra=""):
    return f'<div class="elementor-element elementor-widget elementor-widget-{kind}" data-widget_type="{kind}.default"{extra}>{inner}</div>'


ELEMENTOR_POST = ("""<html><head><title>Old post title</title><link rel="stylesheet" href="/e.css"></head><body><header><nav>Menu</nav></header>
<div data-elementor-type="wp-post" class="elementor elementor-357"><div>Header template</div></div>
<div data-elementor-type="wp-post" class="elementor elementor-9">
<div class="e-con hero"><div class="e-con-inner">""" + _w("theme-post-title", '<div class="elementor-widget-container"><h1 class="elementor-heading-title">Old title</h1></div>')
                  + _w("post-info", '<span class="elementor-post-info__item--type-date"><time>May 1, 2025</time></span>') + """</div></div>
<div class="e-con main"><div class="e-con-inner"><div class="e-con column-a">"""
                  + _w("theme-post-featured-image", '<div class="elementor-widget-container"><img src="/old.jpg"></div>')
                  + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">Old heading one</h2></div>')
                  + _w("text-editor", '<div class="elementor-widget-container"><p>Old paragraph one that will go.</p></div>')
                  + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">Old heading two</h2></div>')
                  + _w("text-editor", '<div class="elementor-widget-container"><p>Old paragraph two that will go.</p></div>')
                  + '<div class="e-con conclusion">' + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">Old conclusion</h2></div>')
                  + _w("text-editor", '<div class="elementor-widget-container"><p>Old conclusion text that will go.</p></div>') + """</div></div>
<div class="e-con column-b">""" + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">Recent Blogs</h2></div>') + _w("ucaddon_post_list", "<ul><li>Another recent post</li></ul>") + """</div></div></div>
<div class="e-con faq"><div class="e-con-inner">""" + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">Frequently Asked Questions</h2></div>')
                  + _w("nested-accordion", '<div class="elementor-widget-container"><div class="e-n-accordion">'
                       + '<details class="e-n-accordion-item" open><summary class="e-n-accordion-item-title"><span class="e-n-accordion-item-title-header"><div class="e-n-accordion-item-title-text">Old question one?</div></span></summary>'
                       + '<div role="region" class="e-con">' + _w("text-editor", '<div class="elementor-widget-container"><p>Old answer one.</p></div>') + '</div></details>'
                       + '<details class="e-n-accordion-item"><summary class="e-n-accordion-item-title"><span class="e-n-accordion-item-title-header"><div class="e-n-accordion-item-title-text">Old question two?</div></span></summary>'
                       + '<div role="region" class="e-con">' + _w("text-editor", '<p>Old answer two.</p>') + '</div></details></div></div>') + """</div></div>
<div class="e-con reviews"><div class="e-con-inner">""" + _w("heading", '<div class="elementor-widget-container"><h2 class="elementor-heading-title">What Clients Say About Us</h2></div>') + """</div></div>
</div>
<div data-elementor-type="wp-post" class="elementor elementor-359"><div>Footer template</div></div>
<footer>Footer text</footer></body></html>""")

ARTICLE_WITH_FAQ = (BODY.replace("<script>steal()</script>", "")
                    + "<h2>Frequently Asked Questions</h2><h3>How much does it cost?</h3><p>It depends on the method that suits you best.</p><h3>Is it painful?</h3><p>Most people feel nothing at all.</p>"
                    + "<h2>Conclusion</h2><p>Teeth whitening pune is a quick way to a brighter smile for most people.</p>")


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


def test_an_elementor_post_keeps_its_whole_layout_and_only_the_article_changes():
    html = sp.render_post(ELEMENTOR_POST, "https://site.example/p/", title="New Elementor Title", body_html=ARTICLE_WITH_FAQ, image="https://site.example/new.jpg", notes=[],
                          mark=lambda h: sp.mark_keywords(h, "teeth whitening pune", ["whitening cost"]))
    s = soup_of(html)
    text = s.get_text(" ", strip=True)
    # what stays: the hero, the sidebar, the reviews block, the header and footer templates
    assert s.select_one(".elementor-widget-theme-post-title h1").get_text() == "New Elementor Title" and s.title.get_text() == "New Elementor Title"
    assert s.select_one(".elementor-widget-theme-post-featured-image img")["src"] == "https://site.example/new.jpg"
    assert s.select_one(".elementor-post-info__item--type-date time").get_text() != "May 1, 2025"
    assert "Recent Blogs" in text and "Another recent post" in text and "What Clients Say About Us" in text and "Header template" in text and "Footer template" in text and "Footer text" in text
    # what goes: every old heading, paragraph, the old conclusion group and the old FAQ
    assert not any(x in text for x in ("Old heading", "Old paragraph", "Old conclusion", "Old question", "Old answer"))
    # what comes: this article as the site's own widgets, in the same column as the picture
    col = s.select_one(".column-a")
    kinds = [w["data-widget_type"].split(".")[0] for w in col.find_all(recursive=False)]
    assert kinds == ["theme-post-featured-image", "text-editor", "heading", "text-editor", "heading", "text-editor"]  # intro, Cost, Conclusion (the FAQ went to the accordion)
    heads = [h.get_text() for h in col.select(".elementor-widget-heading h2.elementor-heading-title")]
    assert heads == ["Cost", "Conclusion"] and "Frequently Asked" not in " ".join(heads)
    assert "Teeth whitening pune is popular" in col.get_text() and col.find("mark", attrs={"data-kw": "primary"}) is not None
    assert col.select_one(".elementor-widget-heading")["data-widget_type"] == "heading.default" and "elementor-widget" in col.select_one(".elementor-widget-heading")["class"]  # cloned from the site's own heading, so its style applies
    # the FAQ accordion holds this article's questions, in the site's own markup
    items = s.select(".e-n-accordion-item")
    assert [i.select_one(".e-n-accordion-item-title-text").get_text() for i in items] == ["How much does it cost?", "Is it painful?"]
    assert "It depends on the method" in items[0].get_text() and "Most people feel nothing" in items[1].get_text() and not any(i.has_attr("open") for i in items)
    assert "Old answer" not in s.get_text()  # also for the newer Elementor markup, where the answer widget has no inner wrapper (the second item in this page)


def test_without_faqs_the_accordion_block_is_dropped_but_the_rest_of_the_page_stays():
    no_faq = BODY.replace("<script>steal()</script>", "")
    s = soup_of(sp.render_post(ELEMENTOR_POST, "https://site.example/p/", title="T", body_html=no_faq, image=None, notes=[]))
    text = s.get_text(" ", strip=True)
    assert "Frequently Asked Questions" not in text and not s.select(".e-n-accordion-item") and "What Clients Say About Us" in text and "Recent Blogs" in text


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
    # a page the browser builds with JavaScript: no design to copy, so a page in the site's own brand is drawn (name, logo, colour and fonts read from its home page and CSS)
    shell = ("<html><head><title>Teeth Whitening in Pune | prevco</title><link rel='icon' href='/logo.png'><link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Lora&family=Inter'>"
             "<link rel='stylesheet' href='/assets/app.css'></head><body><div id='root'></div></body></html>")
    monkeypatch.setattr(sp.bc, "_fetch", lambda url: (200, shell, url, 5, None))
    from app.services import site_preview_brand as sb
    monkeypatch.setattr(sb, "_css_text", lambda url: ".bg-primary{background-color:rgb(6 6 6 / 1)}.bg-accent{background-color:rgb(227 95 20 / 1)}.x{color:#6366f1}.y{color:#6366f1}")
    e = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post", "keyword": "teeth whitening pune"})
    assert e.status_code == 200 and e.json()["source"] == "brand" and "JavaScript" not in e.json()["html"]
    page = e.json()["html"]
    assert "Prevco" in page and "https://site.example/logo.png" in page and "#e35f14" in page and "'Lora'" in page and "'Inter'" in page  # its accent colour, not a library's indigo
    assert "Teeth Whitening Pune: A Guide" in page and "In this article" in page and 'data-kw="primary"' in page and "<script" not in page
    assert "draws its blog in the browser" in " ".join(e.json()["notes"])
    lst = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "list"}).json()
    assert lst["source"] == "brand" and "gz-new" in lst["html"] and "Prevco Blog" in lst["html"]
    bad = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post", "reference_url": "https://site.example/a-post/"})
    assert bad.status_code == 422  # a post the user chose that cannot be read: the reason, not a substitute


TW_POST = """<html><body><div class="min-h-screen"><nav class="top"><a href="/">Home</a><a href="/outfits">Outfits</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav>
<header class="bg-[#f5ede6]"><nav aria-label="Breadcrumb"><a href="/">Home</a><a href="/blog">Blog</a></nav><div class="grid"><div class="lg:col-span-7"><span>WEDDING</span>
<h1 class="text-4xl">Old title</h1><p class="text-lg">Planning a wedding on a budget? This old intro line is long enough to be the lead.</p><span>19 November 2026</span><span>6 min read</span></div>
<div><img src="data:image/webp;base64,OLD"></div></div></header>
<div class="grid"><aside><p>In this article</p><ol><li><a href="#a"><span>01</span><span>Old section one</span></a></li><li><a href="#b"><span>02</span><span>Old section two</span></a></li></ol></aside>
<article><div class="blog-content"><p>""" + "Old article text that should be replaced. " * 20 + """</p><h2 id="a">Old section one</h2></div></article></div>
<section><div class="grid"><a class="group flex" href="/blog/x"><img src="/x.jpg"><h3>Other post</h3><p>18 November 2026</p></a></div></section>
<footer>Footer</footer></div></body></html>"""
TW_LIST = """<html><body><nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/a">A</a><a href="/b">B</a></nav><main><h1>Our Blog</h1><div class="grid">
<div class="rounded-xl shadow"><a href="/blog/one"><img src="/1.jpg"></a><div><h3><a href="/blog/one">Post one</a></h3><p>Excerpt one is long enough.</p></div></div>
<div class="rounded-xl shadow"><a href="/blog/two"><img src="/2.jpg"></a><div><h3><a href="/blog/two">Post two</a></h3><p>Excerpt two is long enough.</p></div></div>
</div></main><footer>Footer</footer></body></html>"""


def test_a_utility_class_site_is_copied_title_picture_intro_date_and_contents_included():
    notes: list[str] = []
    body = "<h1>New</h1><p>A ball gown is the statement piece every formal occasion deserves, and this paragraph is long.</p><h2>Styles</h2><p>x</p><h2>FAQ</h2><p>y</p>"
    html = sp.render_post(TW_POST, "https://site.example/blog/old", title="Ball Gown Guide", body_html=body, image="https://site.example/new.jpg", notes=notes, excerpt="Learn how to choose a ball gown for any formal event.")
    s = BeautifulSoup(html, "html.parser")
    assert s.find("h1").get_text(strip=True) == "Ball Gown Guide"  # the title inside the post's own <header> (it holds a breadcrumb, not the menu)
    assert 'src="https://site.example/new.jpg"' in html and "base64,OLD" not in html
    assert "Learn how to choose a ball gown" in html and "Planning a wedding" not in html and "19 November 2026" not in s.find("header").get_text()
    assert "18 November 2026" in html  # another post's date is left alone
    toc = [a.get_text(" ", strip=True) for a in s.find("ol").find_all("a")]
    hrefs = [a["href"] for a in s.find("ol").find_all("a")]
    assert toc == ["01 Styles", "02 FAQ"] and all(s.find(id=h[1:]) is not None and s.find(id=h[1:]).name == "h2" for h in hrefs)  # each entry jumps to its section
    assert "statement piece" in s.select_one(".blog-content").get_text() and "Old article text" not in html
    cards = sp._cards(BeautifulSoup(TW_LIST, "html.parser"))
    assert len(cards) == 2 and all(c.get("class") == ["rounded-xl", "shadow"] for c in cards)  # cards found by their shape, without a known class name
    out = sp.render_list(TW_LIST, "https://site.example/blog", title="Ball Gown Guide", excerpt="Learn how to choose.", image=None, url="https://site.example/blog/ball-gown", notes=[])
    assert out.index("Ball Gown Guide") < out.index("Post one") and "Your new post" in out


LINK_CARDS = """<html><body><nav><a href="/">Home</a><a href="/blog">Blog</a></nav><main><div class="grid">
<a class="group flex" href="/blog/one"><img src="/1.jpg"><h3>Post one</h3><p>Excerpt one is long enough.</p></a>
<a class="group flex" href="/blog/two"><img src="/2.jpg"><h3>Post two</h3><p>Excerpt two is long enough.</p></a></div></main></body></html>"""


def test_a_card_that_is_itself_one_link_is_found_and_its_new_card_links_to_the_new_post():
    soup = BeautifulSoup(LINK_CARDS, "html.parser")
    cards = sp._cards(soup)
    assert len(cards) == 2 and all(c.name == "a" for c in cards)
    assert [a["href"] for c in cards for a in sp._anchors(c)[:1]] == ["/blog/one", "/blog/two"]  # the post to copy the design from is found even though no link sits inside the card
    out = sp.render_list(LINK_CARDS, "https://site.example/blog", title="New", excerpt="Fresh excerpt text.", image=None, url="https://site.example/blog/new", notes=[])
    first = BeautifulSoup(out, "html.parser").find("a", href="https://site.example/blog/new")
    assert first is not None and "New" in first.get_text() and "Post one" not in first.get_text()  # the new card itself links to the new post, not to the old one


PLACEHOLDER_POST = ("<html><body><header><nav><a href='/'>Home</a><a href='/blog'>Blog</a></nav></header><div id='root'><h1>Article could not be loaded</h1>"
                    "<p>Please try again later.</p></div><footer>Foot</footer></body></html>")


def test_a_could_not_be_loaded_placeholder_is_drawn_in_chrome_and_is_never_the_design_to_copy(monkeypatch):
    from app.services import page_xray as px
    assert sp._is_error_page(PLACEHOLDER_POST) and not sp._is_error_page("<html><body><h1>Real post</h1><p>" + "A real sentence about teeth. " * 40 + "</p></body></html>")
    assert sp._needs_render(PLACEHOLDER_POST)  # long enough to look like a page, but its heading says it is a placeholder: only the browser replaces it
    real = "<html><body><header>Menu</header><h1>Real post</h1><article><p>" + "A real sentence about teeth. " * 150 + "</p></article><footer>Foot</footer></body></html>"
    monkeypatch.setattr(px, "find_chrome", lambda: "chrome")
    monkeypatch.setattr(px, "chrome_dump", lambda chrome, url: (real, None))
    assert sp._rendered("https://site.example/blog/x", PLACEHOLDER_POST) == real
    monkeypatch.setattr(px, "chrome_dump", lambda chrome, url: (PLACEHOLDER_POST, None))
    assert sp._rendered("https://site.example/blog/x", PLACEHOLDER_POST) == PLACEHOLDER_POST  # drawing gave nothing better: the plain page is kept


def test_the_preview_uses_the_publishing_setup_website_and_says_which(client, monkeypatch):
    from app.db import SessionLocal
    from app.services import article_publishing as ap
    bid = client.post("/api/v1/businesses", json={"name": "Setup Co", "website": "https://old-project-site.example/"}).json()["id"]
    pages = {"https://blog-site.example/blog/": LIST_PAGE, "https://blog-site.example/old-one/": POST_PAGE}
    monkeypatch.setattr(sp.bc, "_fetch", lambda url: (200, pages[url], url, 5, None) if url in pages else (404, "", url, 5, None))
    monkeypatch.setattr("app.services.sitemap.discover_site_entries", lambda *a, **k: [])
    monkeypatch.setattr(ap, "destinations", lambda db, b: [{"id": "react", "label": "React.js Website", "target": "https://blog-site.example/blog"}])
    sp._cache.clear()
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword="teeth whitening pune", title="Teeth Whitening Pune: A Guide", status="completed", body=BODY, meta_description="A guide.")
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()
    r = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post"})
    assert r.status_code == 200 and r.json()["site"] == {"host": "blog-site.example", "label": "React.js Website", "from_setup": True, "site": "https://blog-site.example"}
    assert r.json()["reference_url"] == "https://blog-site.example/old-one/"  # read from the Publishing Setup website, not the project's old one
    monkeypatch.setattr(ap, "destinations", lambda db, b: [])
    pages.update({"https://old-project-site.example/blog/": LIST_PAGE, "https://old-project-site.example/old-one/": POST_PAGE})
    sp._cache.clear()
    r2 = client.post(f"/api/v1/businesses/{bid}/articles/{aid}/site-preview", json={"view": "post"}).json()
    assert r2["site"]["from_setup"] is False and r2["site"]["host"] == "old-project-site.example"  # no Publishing Setup website: the project's own


def test_pictures_placed_on_the_images_step_show_in_the_preview(tmp_path, monkeypatch):
    from app.services import content_images as ci
    f = tmp_path / "1-aaaaaaaaaaaa.webp"
    f.write_bytes(b"RIFFxxxxWEBPVP8 data")
    monkeypatch.setattr(ci, "path_of", lambda bid, aid, name: f if name == "1-aaaaaaaaaaaa.webp" else None)
    body = ('<p>Intro</p><figure><img data-gz-image="1-aaaaaaaaaaaa.webp" src="/api/v1/businesses/5/articles/9/content-images/1-aaaaaaaaaaaa.webp" alt="A gown"></figure>'
            '<img data-gz-image="2-bbbbbbbbbbbb.webp" src="/api/v1/x/content-images/2-bbbbbbbbbbbb.webp">')
    out = sp.inline_content_images(body, 5, 9)
    assert 'src="data:image/webp;base64,' in out and "/content-images/1-aaaaaaaaaaaa.webp" not in out and 'alt="A gown"' in out  # embedded from its file
    assert 'src="/api/v1/x/content-images/2-bbbbbbbbbbbb.webp"' in out  # a picture whose file is missing is left as it was
    assert sp.inline_content_images("<p>No pictures</p>", 5, 9) == "<p>No pictures</p>"


def test_a_stylesheet_that_asks_for_cors_still_loads_in_the_sandboxed_frame():
    page = TW_LIST.replace("<body>", '<head><link rel="stylesheet" crossorigin href="/assets/app.css" integrity="sha384-x"></head><body>', 1)
    out = sp.render_list(page, "https://site.example/blog", title="T", excerpt="E", image=None, url="https://site.example/blog/t", notes=[])
    link = BeautifulSoup(out, "html.parser").find("link", href="/assets/app.css")
    assert link is not None and "crossorigin" not in link.attrs and "integrity" not in link.attrs  # a sandboxed frame has no origin: a CORS-checked stylesheet would be blocked


def test_a_javascript_page_is_drawn_in_chrome_only_when_it_is_an_empty_shell(monkeypatch):
    from app.services import page_xray as px
    calls = []
    monkeypatch.setattr(px, "find_chrome", lambda: "chrome")
    monkeypatch.setattr(px, "chrome_dump", lambda chrome, url: (calls.append(url), (TW_POST, None))[1])
    normal = POST_PAGE.replace("</body>", "<p>" + "More page text here. " * 200 + "</p></body>")  # a full page (plenty of text): drawn nowhere, used as it is
    assert sp._rendered("https://site.example/blog/x", normal) == normal and not calls
    shell = "<html><body><div id='root'></div><script src='/a.js'></script><script src='/b.js'></script></body></html>"
    assert sp._rendered("https://site.example/blog/x", shell) == TW_POST and calls == ["https://site.example/blog/x"]
    monkeypatch.setattr(px, "chrome_dump", lambda chrome, url: (None, "failed"))
    assert sp._rendered("https://site.example/blog/x", shell) == shell  # Chrome failed: the plain page, then the brand preview takes over


def test_the_layout_post_can_be_chosen_and_must_be_on_the_projects_own_site(client, monkeypatch):
    bid = client.post("/api/v1/businesses", json={"name": "Ref Co", "website": "https://site.example/"}).json()["id"]
    pages = {"https://site.example/blog/": LIST_PAGE, "https://site.example/my-favourite-post/": ELEMENTOR_POST, "https://site.example/old-one/": POST_PAGE}
    monkeypatch.setattr(sp.bc, "_fetch", lambda url: (200, pages[url], url, 5, None) if url in pages else (404, "", url, 5, None))
    monkeypatch.setattr("app.services.sitemap.discover_site_entries", lambda *a, **k: [])
    sp._cache.clear()
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        a = Article(business_id=bid, keyword="teeth whitening pune", title="Teeth Whitening Pune: A Guide", status="completed", body=ARTICLE_WITH_FAQ, meta_description="A guide.")
        db.add(a)
        db.commit()
        aid = a.id
    finally:
        db.close()
    url = f"/api/v1/businesses/{bid}/articles/{aid}/site-preview"
    auto = client.post(url, json={"view": "post"}).json()
    assert auto["reference_url"] == "https://site.example/old-one/"  # no choice: the first post on the blog page
    chosen = client.post(url, json={"view": "post", "reference_url": "https://site.example/my-favourite-post/"}).json()
    assert chosen["reference_url"] == "https://site.example/my-favourite-post/" and "Elementor" in " ".join(chosen["notes"]) and "Recent Blogs" in chosen["html"]
    other = client.post(url, json={"view": "post", "reference_url": "https://someone-else.example/post/"})
    assert other.status_code == 422 and "own website" in other.json()["detail"]  # no reading of other people's pages
