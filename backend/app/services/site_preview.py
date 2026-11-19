"""A preview of an article inside the website's own blog pages.

The site's real blog page and one of its real posts are read (through the SSRF-safe fetcher), cleaned so nothing runs, and the article is put where the old content was: in the
blog's list (as one more card, cloned from the site's own) and in the blog's details page (title, picture, date and body). The site keeps its own header, footer, fonts and colours
because its own stylesheets are loaded. The result is shown in a sandboxed frame, so none of the site's scripts run.

Sites differ, so the content area is found in order: an Elementor post (title and picture kept, the old body replaced), a known content class (entry-content, post-content ...), the
page's article or main element, and last the page between its header and footer. A site that builds its blog with JavaScript has no readable HTML: the reason is given.
"""
import copy
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Comment, NavigableString, Tag
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business
from . import backlink_checker as bc

CACHE_SECONDS = 600
_cache: dict[str, tuple[float, str]] = {}

CARD_SELECTORS = ["article.elementor-post", "li.wp-block-post", "article.post", ".blog-card", ".post-card", ".blog-item", ".post-item", ".blog-post", "article"]
CONTENT_SELECTORS = [".elementor-widget-theme-post-content", "[itemprop='articleBody']", ".entry-content", ".post-content", ".single-post-content", ".blog-content", ".article-content",
                     ".post__content", ".post-body", ".blog-details-content", ".blog-detail-content", ".prose"]
TITLE_SELECTORS = [".elementor-widget-theme-post-title .elementor-heading-title", ".elementor-widget-theme-post-title h1", "h1.entry-title", "h1.post-title", ".post-title", ".entry-title", "article h1", "main h1", "h1"]
IMAGE_SELECTORS = [".elementor-widget-theme-post-featured-image img", "img.wp-post-image", ".post-thumbnail img", ".featured-image img", ".blog-details-img img", ".post-image img"]
DATE_SELECTORS = [".elementor-post-info__item--type-date", ".entry-date", ".post-date", ".posted-on", "time"]
LIST_PATHS = ["/blog/", "/blogs/", "/news/", "/articles/", "/insights/", "/resources/"]

REVEAL_CSS = ("<style id='growzen-preview'>.elementor-invisible,.wow,[data-aos],.animated,.fade-in,.reveal{visibility:visible!important;opacity:1!important;transform:none!important;animation:none!important}"
              "html{scroll-behavior:auto!important}[data-elementor-type=popup],.elementor-popup-modal,.cookie-banner,#cookie-notice,.cmplz-cookiebanner{display:none!important}</style>")


class PreviewError(Exception):
    pass


def _fetch(url: str) -> str:
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    status, html, _final, _ms, error = bc._fetch(url)
    if error or status != 200 or not html:
        raise PreviewError(f"Your site's page {url} could not be read ({error or 'HTTP ' + str(status)}).")
    if len(_cache) > 40:
        _cache.clear()
    _cache[url] = (time.time(), html)
    return html


# ------------------------------------------------------------------------------------------------------------------------ finding the site's blog pages
def _cards(soup: BeautifulSoup) -> list[Tag]:
    for sel in CARD_SELECTORS:
        found = [c for c in soup.select(sel) if c.find("a", href=True) and c.find(["h2", "h3", "h4"]) and not _inside(c, ("header", "footer", "nav"))]
        if len(found) >= 2:
            return found
    return []


def _inside(el: Tag, names: tuple[str, ...]) -> bool:
    return any(p.name in names or p.get("data-elementor-type") in ("header", "footer") for p in el.parents if isinstance(p, Tag))


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def listing_page(db: Session, b: Business) -> tuple[str, str]:
    """(url, html) of the page that lists the site's blog posts."""
    from . import sitemap
    site = (b.website or "").strip().rstrip("/")
    if not site.startswith("http"):
        raise PreviewError("Add the project's website first: the preview uses its own blog design.")
    tried: list[str] = []
    for (u,) in db.execute(select(Article.wp_url).where(Article.business_id == b.id, Article.wp_status == "publish", Article.wp_url.is_not(None)).order_by(Article.id.desc()).limit(3)):
        parts = [x for x in urlsplit(u or "").path.split("/") if x]
        if len(parts) > 1:
            tried.append(f"{_origin(u)}/" + "/".join(parts[:-1]) + "/")
    tried += [site + p for p in LIST_PATHS]

    def first_working(urls: list[str]) -> tuple[str, str] | None:
        for u in dict.fromkeys(urls):
            try:
                html = _fetch(u)
            except PreviewError:
                continue
            if _cards(BeautifulSoup(html, "html.parser")):
                return u, html
        return None

    found = first_working(tried)
    if found:
        return found
    try:  # the usual paths did not work: the sitemap may name the blog page
        found = first_working([u for u, _ in sitemap.discover_site_entries(site, 300) if urlsplit(u).path.strip("/").lower() in {x.strip("/") for x in LIST_PATHS}])
    except Exception:  # noqa: BLE001
        found = None
    if found:
        return found
    raise PreviewError("The site's blog page could not be found, or it builds its posts with JavaScript, which cannot be read here. Publish one post, then try again.")


def _same_site(url: str, b: Business) -> bool:
    host = lambda u: (urlsplit(u).hostname or "").lower().removeprefix("www.")  # noqa: E731
    return bool(host(url)) and host(url) == host(b.website or "")


def configured_reference(db: Session, b: Business) -> str | None:
    """The post the publisher uses as its layout (the website connection's layout_post_id), as an address."""
    from ..models import SiteIntegration
    from .net import site_client
    row = db.scalar(select(SiteIntegration).where(SiteIntegration.business_id == b.id))
    pid = str((row.config or {}).get("layout_post_id") or "") if row else ""
    if not (row and pid.isdigit() and row.base_url):
        return None
    try:
        with site_client(15) as c:
            r = c.get(f"{row.base_url.rstrip('/')}/wp-json/wp/v2/posts/{pid}", params={"_fields": "link"})
        return r.json().get("link") if r.status_code == 200 else None
    except Exception:  # noqa: BLE001
        return None


def reference_post(db: Session, b: Business, list_url: str, list_html: str, explicit: str | None = None) -> tuple[str, str]:
    """(url, html) of the post whose design the preview copies: the one named (it must be on the project's own website), else the one the publisher uses, else the first post on the
    site's blog page, else the newest the app published."""
    if explicit:
        if not _same_site(explicit, b):
            raise PreviewError("The layout post must be a page of the project's own website.")
        return explicit, _fetch(explicit)
    urls: list[str] = []
    configured = configured_reference(db, b)
    if configured:
        urls.append(configured)
    cards = _cards(BeautifulSoup(list_html, "html.parser"))
    urls += [urljoin(list_url, a["href"]) for c in cards[:3] for a in c.find_all("a", href=True)[:1]]
    urls += [u for (u,) in db.execute(select(Article.wp_url).where(Article.business_id == b.id, Article.wp_status == "publish", Article.wp_url.is_not(None)).order_by(Article.id.desc()).limit(2))]
    for u in dict.fromkeys(urls):
        try:
            return u, _fetch(u)
        except PreviewError:
            continue
    raise PreviewError("None of the site's posts could be read.")


# ------------------------------------------------------------------------------------------------------------------------ cleaning a page so it is safe and shows without its scripts
def _clean(soup: BeautifulSoup, base: str) -> None:
    for t in soup.find_all(["script", "noscript", "iframe", "object", "embed"]):
        t.decompose()
    for t in soup.find_all("link", rel=lambda v: v and any(x in " ".join(v if isinstance(v, list) else [v]) for x in ("preload", "prefetch", "modulepreload", "dns-prefetch"))):
        t.decompose()
    for t in soup.find_all("meta", attrs={"http-equiv": re.compile("refresh", re.I)}):
        t.decompose()
    for t in soup.find_all("base"):
        t.decompose()
    for el in soup.find_all(True):
        for attr in [a for a in el.attrs if a.lower().startswith("on")]:
            del el.attrs[attr]
        if el.name == "img":
            lazy = el.get("data-lazy-src") or el.get("data-src")
            if lazy:
                el["src"] = lazy
            if el.get("data-lazy-srcset") or el.get("data-srcset"):
                el["srcset"] = el.get("data-lazy-srcset") or el.get("data-srcset")
            el.attrs.pop("loading", None)
    for el in soup.select(".elementor-invisible"):
        el["class"] = [c for c in el.get("class", []) if c != "elementor-invisible"]
    head = soup.head or soup.new_tag("head")
    if soup.head is None:
        (soup.html or soup).insert(0, head)
    head.insert(0, BeautifulSoup(f"<base href='{base}'><meta name='robots' content='noindex'>{REVEAL_CSS}", "html.parser"))


def _today() -> str:
    return datetime.now().strftime("%B %d, %Y")


def _set_text(el: Tag, text: str) -> None:
    for child in list(el.children):
        child.extract()
    el.append(NavigableString(text))


def _first(soup: Tag, selectors: list[str], skip=("header", "footer", "nav")) -> Tag | None:
    for sel in selectors:
        for el in soup.select(sel):
            if not _inside(el, skip):
                return el
    return None


# ------------------------------------------------------------------------------------------------------------------------ the article's own HTML
def article_html(body: str, drop_h1: bool) -> str:
    soup = BeautifulSoup(body or "", "html.parser")
    for t in soup.find_all(["script", "style", "iframe"]):
        t.decompose()
    for el in soup.find_all(True):
        for attr in [a for a in el.attrs if a.lower().startswith("on")]:
            del el.attrs[attr]
    if drop_h1:
        h1 = soup.find("h1")
        if h1:
            h1.decompose()
    return str(soup)


def mark_keywords(html: str, primary: str | None, secondary: list[str]) -> str:
    """Wrap each keyword in a coloured <mark> (text only: tags, links and attributes are untouched), and flag a paragraph that has none with a red bar on its left."""
    phrases = []
    for k, kind in [(primary, "primary"), *[(s, "secondary") for s in secondary or []]]:
        k = " ".join((k or "").split())
        if len(k) > 1 and k.lower() not in [p[0].lower() for p in phrases]:
            phrases.append((k, kind))
    if not phrases:
        return html
    kinds = {" ".join(k.lower().split()): kind for k, kind in phrases}
    rx = re.compile(r"(?<!\w)(" + "|".join(re.escape(k).replace(r"\ ", r"\s+") for k, _ in sorted(phrases, key=lambda x: -len(x[0]))) + r")(?!\w)", re.I)
    styles = {"primary": "background:#fde68a;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #f59e0b",
              "secondary": "background:#bae6fd;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #0ea5e9",
              "brand": "background:#bbf7d0;color:inherit;padding:0 2px;border-radius:3px;font-weight:600;box-shadow:inset 0 -2px 0 #22c55e"}
    soup = BeautifulSoup(html, "html.parser")
    for st in soup.find_all("strong", attrs={"data-gz": True}):  # the bold the article carries is coloured here, for checking only: the website gets it bold
        st["style"] = styles.get(st["data-gz"], styles["secondary"])
    for node in list(soup.find_all(string=True)):
        if isinstance(node, Comment) or node.parent.name in ("script", "style", "mark", "textarea") or node.find_parent(["strong", "b"]) is not None:
            continue
        text = str(node)
        if not rx.search(text):
            continue
        frag, last = [], 0
        for m in rx.finditer(text):
            if m.start() > last:
                frag.append(NavigableString(text[last:m.start()]))
            kind = kinds.get(" ".join(m.group(0).lower().split()), "secondary")
            mark = soup.new_tag("mark", style=styles[kind])
            mark["data-kw"] = kind
            mark.string = m.group(0)
            frag.append(mark)
            last = m.end()
        if last < len(text):
            frag.append(NavigableString(text[last:]))
        for piece in frag:
            node.insert_before(piece)
        node.extract()
    for p in soup.find_all("p"):
        if len(p.get_text(" ", strip=True).split()) >= 6 and not p.find("mark") and not p.find("strong", attrs={"data-gz": True}):
            p["style"] = (p.get("style", "") + ";border-left:3px solid #fca5a5;padding-left:8px").lstrip(";")
            p["title"] = "No keyword in this paragraph"
    return str(soup)


# ------------------------------------------------------------------------------------------------------------------------ the blog details page
def _lca(els: list[Tag]) -> Tag | None:
    chains = [list(reversed([e, *[p for p in e.parents if isinstance(p, Tag)]])) for e in els]
    common = None
    for i in range(min(len(c) for c in chains)):
        if all(c[i] is chains[0][i] for c in chains):
            common = chains[0][i]
        else:
            break
    return common


def _prune_empty(root: Tag) -> None:
    """Remove the containers a content removal left empty (no text, picture or widget), from the inside out."""
    for el in reversed(list(root.find_all(["div", "section", "ul", "figure"]))):
        if el is root or el.has_attr("data-growzen") or el.find(attrs={"data-growzen": True}) or el.find(["img", "svg", "video", "input", "button"]) or el.get_text(strip=True) or el.find(attrs={"data-widget_type": True}):
            continue
        el.decompose()


CONTENT_KINDS = ("heading", "text-editor")


def _kind(el) -> str:
    return (el.get("data-widget_type") or "").split(".")[0] if isinstance(el, Tag) else ""


def _content_column(root: Tag) -> Tag | None:
    """The element that holds the article's sections: the most direct heading and text widgets (the featured picture counts too). The same rule the publisher uses."""
    best, score = None, 0
    for el in root.find_all(True):
        kids = el.find_all(recursive=False)
        n = sum(1 for k in kids if _kind(k) in CONTENT_KINDS) + (2 if any(_kind(k) == "theme-post-featured-image" for k in kids) else 0)
        if n > score:
            best, score = el, n
    return best if score >= 2 else None


def _render_elementor(soup: BeautifulSoup, body: str, mark, notes: list[str]) -> bool:
    """Put the article into an Elementor post exactly as the app publishes it: the page keeps everything (header, title, date, featured picture, sidebar with Recent Blogs, the
    reviews and clients blocks, footer); only the article's own heading and text widgets are replaced by this article's sections, and the FAQ accordion gets this article's FAQs.
    Returns False when the page is not laid out that way."""
    import html as html_lib

    from . import elementor_layout as lay
    root = next((r for r in soup.select('[data-elementor-type="wp-post"]') if r.select_one('[data-widget_type^="theme-post-title"]')), None)
    col = _content_column(root) if root is not None else None
    if col is None:
        return False
    kids = col.find_all(recursive=False)
    first = next(i for i, k in enumerate(kids) if _kind(k) in CONTENT_KINDS)
    head_tpl = next((copy.copy(k) for k in kids if _kind(k) == "heading"), None)
    text_tpl = next((copy.copy(k) for k in kids if _kind(k) == "text-editor"), None)
    if head_tpl is None or text_tpl is None:
        return False
    has_cta = bool(col.select('[data-widget_type^="button"]'))
    accordion = root.select_one('[data-widget_type^="nested-accordion"]')
    intro, sections, _schema = lay.split_sections(lay.clean_body(body))
    faqs: list[tuple[str, str]] | None = None
    widgets: list[Tag] = []

    def heading(text: str) -> Tag:
        w = copy.copy(head_tpl)
        h = w.select_one(".elementor-heading-title") or w.find(["h1", "h2", "h3", "h4", "h5", "h6"])
        if h is not None:
            h.name = "h2"
            h.clear()
            h.append(BeautifulSoup(mark(html_lib.escape(text, quote=False)), "html.parser"))
        return w

    def text(h: str) -> Tag:
        w = copy.copy(text_tpl)
        box = w.select_one(".elementor-widget-container") or w
        box.clear()
        box.append(BeautifulSoup(mark(h), "html.parser"))
        return w

    if lay._text(intro):
        widgets.append(text(intro))
    for title, sec in sections:
        if lay._FAQ_H2.match(title) and accordion is not None:
            faqs = lay.faqs_from(sec)  # shown in the site's FAQ accordion instead
            continue
        if has_cta and lay._CTA_H2.match(title):  # the layout's own call-to-action box stands in for the article's contact block
            continue
        widgets.append(heading(title))
        if lay._text(sec):
            widgets.append(text(sec))
    def old_content(k: Tag) -> bool:
        """A heading or text widget, or a group holding nothing but those (the reference's own conclusion): the old article, not layout."""
        if _kind(k) in CONTENT_KINDS:
            return True
        inner = k.select("[data-widget_type]")
        return bool(inner) and all(_kind(w) in CONTENT_KINDS for w in inner)

    after = [k for k in kids[first:] if not old_content(k)]
    for k in kids:
        if old_content(k):
            k.decompose()
    for w in widgets:
        (after[0].insert_before(w) if after else col.append(w))
    faq_note = ""
    if accordion is not None:
        items = accordion.select("details")
        faqs = faqs or []
        if faqs and items:
            tpl, holder = copy.copy(items[0]), items[0].parent
            for d in items:
                d.decompose()
            for q, ans in faqs:
                d = copy.copy(tpl)
                d.attrs.pop("open", None)
                title_el = d.select_one(".e-n-accordion-item-title-text") or d.find("summary")
                if title_el is not None:
                    _set_text(title_el, q)
                answer_widget = d.select_one('[data-widget_type^="text-editor"]')
                body_box = (answer_widget.select_one(".elementor-widget-container") or answer_widget) if answer_widget is not None else None  # newer Elementor has no inner wrapper
                if body_box is not None:
                    body_box.clear()
                    body_box.append(BeautifulSoup(mark(ans if ans.lstrip().startswith("<") else f"<p>{html_lib.escape(ans, quote=False)}</p>"), "html.parser"))
                holder.append(d)
            faq_note = f" and {len(faqs)} FAQ{'s' if len(faqs) != 1 else ''} in its accordion"
        elif not faqs:
            top = accordion
            while top.parent is not None and top.parent is not root:
                top = top.parent
            if top is not accordion and top is not col and col not in top.descendants:
                top.decompose()
    notes.append(f"Built in your site's Elementor post layout: {sum(1 for w in widgets if _kind(w) == 'heading')} sections{faq_note}. Its sidebar, reviews and footer are kept as they are.")
    return True


def render_post(page: str, base: str, *, title: str, body_html: str, image: str | None, notes: list[str], mark=None) -> str:
    mark = mark or (lambda h: h)  # colours the keywords in a piece of HTML (the identity when the preview is plain)
    soup = BeautifulSoup(page, "html.parser")
    _clean(soup, base)
    title_el = _first(soup, TITLE_SELECTORS)
    wrapper_open = "<div class='growzen-article'>"
    done = _render_elementor(soup, body_html, mark, notes)

    texts = [e for e in soup.select(".elementor-widget-text-editor") if not _inside(e, ("header", "footer", "nav"))]
    area = _first(soup, CONTENT_SELECTORS)
    if not done and area is not None and len(area.get_text(" ", strip=True)) >= 150 and not texts:
        area.clear()
        area.append(BeautifulSoup(mark(article_html(body_html, drop_h1=title_el is not None and title_el not in area.descendants)), "html.parser"))
        notes.append("Placed in the site's content area.")
        done = True
    if not done and texts:  # an Elementor page that is not laid out as heading and text widgets
        keep = copy.copy(texts[0])
        marker = soup.new_tag("div", attrs={"data-growzen": "here"})
        texts[0].insert_before(marker)
        # the whole post: the Elementor container the first text block sits in (its sections hold the old body, FAQ and calls to action), else the nearest common ancestor of the text blocks
        scope = texts[0].find_parent(attrs={"data-elementor-type": "wp-post"}) or texts[0].find_parent(class_="elementor") or _lca(texts)
        # the old body goes: its text, headings, images, buttons and lists; the title, the featured picture and the date stay
        for el in list(scope.select("[data-widget_type]")) if scope is not None else []:
            if getattr(el, "attrs", None) is None:  # already removed together with a widget that held it
                continue
            kind = (el.get("data-widget_type") or "").split(".")[0]
            if kind in ("theme-post-title", "theme-post-featured-image", "post-info", "theme-post-content") or el is title_el or _inside(el, ("header", "footer", "nav")):
                continue
            if el.find(attrs={"data-widget_type": re.compile("theme-post-title|theme-post-featured-image|post-info")}):
                continue
            el.decompose()
        if scope is not None:
            _prune_empty(scope)
        box = marker if marker.parent else None
        if box is None and scope is not None:
            box = soup.new_tag("div")
            scope.append(box)
        container = keep.select_one(".elementor-widget-container")
        if container is not None:
            container.clear()
            container.append(BeautifulSoup(mark(article_html(body_html, drop_h1=title_el is not None)), "html.parser"))
            marker.replace_with(keep)
        else:
            marker.replace_with(BeautifulSoup(wrapper_open + mark(article_html(body_html, drop_h1=title_el is not None)) + "</div>", "html.parser"))
        notes.append("Built in your site's Elementor post design.")
        done = True
    if not done:
        main = _first(soup, ["article", "main", "#content", ".site-content", "#primary"], skip=("header", "footer", "nav"))
        if main is not None and len(main.get_text(" ", strip=True)) >= 150:
            main.clear()
            main.append(BeautifulSoup(f"<div style='max-width:820px;margin:0 auto;padding:24px 16px'>{mark(article_html(body_html, drop_h1=False))}</div>", "html.parser"))
            notes.append("Placed in the site's main content area.")
        elif soup.body is not None:
            keep_tags = [c for c in soup.body.find_all(recursive=False) if c.name in ("header", "footer", "nav", "style") or c.get("data-elementor-type") in ("header", "footer")]
            for c in list(soup.body.find_all(recursive=False)):
                if c not in keep_tags:
                    c.decompose()
            holder = BeautifulSoup(f"<main style='max-width:820px;margin:0 auto;padding:32px 16px'>{mark(article_html(body_html, drop_h1=False))}</main>", "html.parser")
            foot = next((c for c in keep_tags if c.name == "footer" or c.get("data-elementor-type") == "footer"), None)
            (foot.insert_before(holder) if foot is not None else soup.body.append(holder))
            notes.append("Placed between the site's header and footer.")
    # title, picture, date
    t = _first(soup, TITLE_SELECTORS)
    if t is not None and title:
        _set_text(t, title)
    if soup.title is not None and title:
        soup.title.string = title
    if image:
        img = _first(soup, IMAGE_SELECTORS)
        if img is not None:
            img["src"] = image
            for a in ("srcset", "sizes", "data-src", "data-lazy-src"):
                img.attrs.pop(a, None)
    d = _first(soup, DATE_SELECTORS)
    if d is not None:
        inner = d.find("time") or d
        _set_text(inner, _today())
        if inner.name == "time":
            inner["datetime"] = datetime.now().strftime("%Y-%m-%d")
    return "<!doctype html>" + str(soup)


# ------------------------------------------------------------------------------------------------------------------------ the blog list
def render_list(page: str, base: str, *, title: str, excerpt: str, image: str | None, url: str, notes: list[str]) -> str:
    soup = BeautifulSoup(page, "html.parser")
    _clean(soup, base)
    cards = _cards(soup)
    if not cards:
        raise PreviewError("The site's blog page has no readable post cards.")
    first = cards[0]
    new = copy.copy(first)
    classes = [c for c in (new.get("class") or []) if not re.fullmatch(r"post-\d+|category-.*|tag-.*", c)]
    new["class"] = classes
    for a in new.find_all("a", href=True):
        a["href"] = url
    head = new.find(["h2", "h3", "h4"])
    if head is not None:
        link = head.find("a")
        _set_text(link if link is not None else head, title)
    ex = new.select_one(".elementor-post__excerpt p, .excerpt, .entry-summary p, .post-excerpt, .card-text") or next((p for p in new.find_all("p") if len(p.get_text(strip=True)) > 20), None)
    if ex is not None:
        _set_text(ex, excerpt or "")
    if image:
        img = new.find("img")
        if img is not None:
            img["src"] = image
            for a in ("srcset", "sizes", "data-src", "data-lazy-src"):
                img.attrs.pop(a, None)
    for d in new.select("time, .elementor-post-date, .entry-date, .post-date"):
        _set_text(d, _today())
    new["style"] = (new.get("style", "") + ";outline:3px solid #4f46e5;outline-offset:2px;position:relative").lstrip(";")
    new.insert(0, BeautifulSoup("<span style='position:absolute;top:8px;left:8px;z-index:9;background:#4f46e5;color:#fff;font:600 11px/1 sans-serif;padding:5px 9px;border-radius:999px'>Your new post</span>", "html.parser"))
    first.insert_before(new)
    cards[-1].decompose() if len(cards) >= 4 else None  # the newest post takes the place of the oldest on the first page
    notes.append(f"Added to your site's blog page as its newest post ({len(cards)} cards found).")
    return "<!doctype html>" + str(soup)


# ------------------------------------------------------------------------------------------------------------------------ the entry point
def build(db: Session, b: Business, a: Article, *, view: str, title: str, excerpt: str, body: str, image: str | None, url: str,
          primary: str | None, secondary: list[str], highlight: bool, reference_url: str | None = None) -> dict:
    """The page as the site would show it with this article. Raises PreviewError with the reason when the site's design cannot be read."""
    list_url, list_html = listing_page(db, b)
    notes: list[str] = []
    mark = (lambda h: mark_keywords(h, primary, secondary)) if highlight else (lambda h: h)
    if view == "list":
        html = render_list(list_html, list_url, title=title, excerpt=excerpt, image=image, url=url, notes=notes)
        return {"html": html, "reference_url": list_url, "view": "list", "notes": notes}
    ref_url, ref_html = reference_post(db, b, list_url, list_html, reference_url)
    html = render_post(ref_html, ref_url, title=title, body_html=body, image=image, notes=notes, mark=mark)
    notes.append(f"Design read from {ref_url}.")
    return {"html": html, "reference_url": ref_url, "view": "post", "notes": notes}
