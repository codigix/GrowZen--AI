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
CONTENT_SELECTORS = [".elementor-widget-theme-post-content", "[itemprop='articleBody']", ".entry-content", ".post-content", ".single-post-content", ".blog-content", ".blog-body", ".article-content",
                     ".post__content", ".post-body", ".blog-details-content", ".blog-detail-content", ".prose"]
TITLE_SELECTORS = [".elementor-widget-theme-post-title .elementor-heading-title", ".elementor-widget-theme-post-title h1", "h1.entry-title", "h1.post-title", ".post-title", ".entry-title", "article h1", "main h1", "h1"]
IMAGE_SELECTORS = [".elementor-widget-theme-post-featured-image img", "img.wp-post-image", ".post-thumbnail img", ".featured-image img", ".blog-details-img img", ".post-image img"]
DATE_SELECTORS = [".elementor-post-info__item--type-date", ".entry-date", ".post-date", ".posted-on", "time"]
LIST_PATHS = ["/blog/", "/blogs/", "/news/", "/articles/", "/insights/", "/resources/"]

REVEAL_CSS = ("<style id='growzen-preview'>.elementor-invisible,.wow,[data-aos],.animated,.fade-in,.reveal{visibility:visible!important;opacity:1!important;transform:none!important;animation:none!important}"
              "html{scroll-behavior:auto!important}[data-elementor-type=popup],.elementor-popup-modal,.cookie-banner,#cookie-notice,.cmplz-cookiebanner{display:none!important}</style>")


# Reading comfort for the article we put in: sites that style their posts with a typography class (prose, entry-content...) do not style ours until it carries that class, so
# paragraphs would touch and headings would be huge. :where() gives these rules no weight, so any rule of the site itself wins.
FILL_CSS = ("<style id='growzen-fill'>:where(.growzen-fill) p{margin:0 0 1.1em}:where(.growzen-fill) h2{margin:1.6em 0 .5em;font-size:1.55em;line-height:1.25}"
            ":where(.growzen-fill) h3{margin:1.3em 0 .4em;font-size:1.25em;line-height:1.3}:where(.growzen-fill) ul,:where(.growzen-fill) ol{margin:0 0 1.1em;padding-left:1.4em}"
            ":where(.growzen-fill) li{margin:.3em 0}:where(.growzen-fill) img{max-width:100%;height:auto}:where(.growzen-fill) table{border-collapse:collapse;width:100%}"
            ":where(.growzen-fill) th,:where(.growzen-fill) td{border:1px solid #e2e8f0;padding:.5em .7em;text-align:left}</style>")


class PreviewError(Exception):
    pass


def _fetch(url: str) -> str:
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    status, html, _final, _ms, error = bc._fetch(url)
    if error or status != 200 or not html:
        raise PreviewError(f"Your site's page {url} could not be read ({error or 'HTTP ' + str(status)}).")
    html = _rendered(url, html)
    if len(_cache) > 40:
        _cache.clear()
    _cache[url] = (time.time(), html)
    return html


_ERROR_PAGE = re.compile(r"could not be loaded|couldn['’]?t be loaded|failed to load|page not found|not found|404|something went wrong|loading\s*\.\.\.|enable javascript|no posts? found", re.I)


def _text_of(html: str) -> tuple[str, str]:
    """(visible text, first heading) of a page, without scripts and styles."""
    soup = BeautifulSoup(html or "", "html.parser")
    h1 = soup.find("h1")
    heading = h1.get_text(" ", strip=True) if h1 else ""
    for t in soup(["script", "style", "noscript", "template"]):
        t.decompose()
    return " ".join(soup.get_text(" ", strip=True).split()), heading


def _is_error_page(html: str) -> bool:
    """A page that is a placeholder or an error, not a post: its heading says so, or it has almost no text."""
    text, heading = _text_of(html)
    return bool(_ERROR_PAGE.search(heading)) or len(text) < 400 or bool(_ERROR_PAGE.search(text[:1500]) and len(text) < 3500)


def _needs_render(html: str) -> bool:
    from ..backlinks.renderer import looks_js_rendered
    if looks_js_rendered(html):
        return True
    text, heading = _text_of(html)
    return len(text) < 2500 or bool(_ERROR_PAGE.search(heading))  # a thin page, or a "could not be loaded" placeholder that only the browser replaces


def _rendered(url: str, html: str) -> str:
    """A page the browser builds with JavaScript (React, Vue...): its HTML is an empty shell or a placeholder, so it is drawn in headless Chrome and the finished page is used.
    Only pages of the project's own website come here (the blog page and its posts). The plain HTML is kept when Chrome is missing or fails, or when drawing it gave less."""
    if not _needs_render(html):
        return html
    from . import page_xray as px
    chrome = px.find_chrome()
    if not chrome:
        return html
    try:
        done, _err = px.chrome_dump(chrome, url)
    except Exception:  # noqa: BLE001 - the plain HTML is still a page
        return html
    if not done:
        return html
    before, after = _text_of(html), _text_of(done)
    return done if len(after[0]) > len(before[0]) * 1.3 or (_is_error_page(html) and not _is_error_page(done)) else html


# ------------------------------------------------------------------------------------------------------------------------ finding the site's blog pages
def _cards(soup: BeautifulSoup) -> list[Tag]:
    for sel in CARD_SELECTORS:
        found = [c for c in soup.select(sel) if _anchors(c) and c.find(["h2", "h3", "h4"]) and not _inside(c, ("header", "footer", "nav"))]
        if len(found) >= 2:
            return found
    return _cards_by_shape(soup)


def _cards_by_shape(soup: BeautifulSoup) -> list[Tag]:
    """Cards without a known class (Tailwind and other utility-class sites): the largest element around each post link that holds a heading and links to that post only,
    kept when at least two of them share the same tag and classes."""
    by_href: dict[str, Tag] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].split("#")[0].rstrip("/")
        if not href or href.startswith(("mailto:", "tel:", "javascript:")) or _inside(a, ("header", "footer", "nav")) or href in by_href:
            continue
        el = a
        while el.parent is not None and el.parent.name not in ("body", "main", "html", "[document]"):
            hrefs = {x["href"].split("#")[0].rstrip("/") for x in el.parent.find_all("a", href=True)}
            if hrefs - {href}:
                break
            el = el.parent
        if el.find(["h2", "h3", "h4", "h5"]) and el.find("img"):
            by_href[href] = el
    groups: dict[tuple, list[Tag]] = {}
    for el in by_href.values():
        groups.setdefault((el.name, tuple(sorted(el.get("class") or []))), []).append(el)
    best = max(groups.values(), key=len, default=[])
    return best if len(best) >= 2 else []


def _anchors(card: Tag) -> list[Tag]:
    """The links of a card, including the card itself when the whole card is one link (<a class="card">...</a>)."""
    return ([card] if card.name == "a" and card.get("href") else []) + card.find_all("a", href=True)


def _inside(el: Tag, names: tuple[str, ...]) -> bool:
    return any((p.name in names and not _post_header(p)) or p.get("data-elementor-type") in ("header", "footer") for p in el.parents if isinstance(p, Tag))


def _post_header(el: Tag) -> bool:
    """A <header> that is the post's own heading block (title, picture, date), not the site's top bar: it holds the page title and no menu (a breadcrumb is not a menu)."""
    if el.name != "header" or el.find("h1") is None:
        return False
    for nav in el.find_all("nav"):
        label = " ".join([nav.get("aria-label") or "", " ".join(nav.get("class") or [])]).lower()
        if "breadcrumb" not in label and len(nav.find_all("a", href=True)) > 3:
            return False
    return True


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def publish_site(db: Session, b: Business) -> dict:
    """The website the preview is drawn from: the one set up in Publishing Setup (WordPress, React.js or HTML website) first, else the project's own website.
    {site: address of the home page, blog: the blog page when Publishing Setup names it, label: the kind of website, host}."""
    from . import article_publishing as ap
    try:
        dests = ap.destinations(db, b)
    except Exception:  # noqa: BLE001 - Publishing Setup is only a pointer: the project's website still works
        dests = []
    for d in dests:
        target = str(d.get("target") or "").strip()
        if target.startswith("http"):
            p = urlsplit(target)
            blog = target if BLOG_PATH_RE.search(p.path or "") else None
            return {"site": f"{p.scheme}://{p.netloc}", "blog": blog, "label": d.get("label"), "host": p.hostname or "", "from_setup": True}
    site = (b.website or "").strip().rstrip("/")
    site = site if site.startswith("http") or not site else f"https://{site}"
    return {"site": site, "blog": None, "label": None, "host": urlsplit(site).hostname or "", "from_setup": False}


BLOG_PATH_RE = re.compile(r"/(blog|blogs|news|articles|insights|resources|journal)(/|$)", re.I)


def listing_page(db: Session, b: Business) -> tuple[str, str]:
    """(url, html) of the page that lists the site's blog posts."""
    from . import sitemap
    ps = publish_site(db, b)
    site = ps["site"].rstrip("/")
    if not site.startswith("http"):
        raise PreviewError("Add the project's website first: the preview uses its own blog design.")
    tried: list[str] = [ps["blog"].rstrip("/") + "/"] if ps["blog"] else []
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


def _same_site(url: str, b: Business, extra: str = "") -> bool:
    """The address is a page of the project's own website, or of the website set up in Publishing Setup (`extra`)."""
    host = lambda u: (urlsplit(u).hostname or "").lower().removeprefix("www.")  # noqa: E731
    return bool(host(url)) and host(url) in {host(b.website or ""), host(extra or "")} - {""}


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
        if not _same_site(explicit, b, publish_site(db, b)["site"]):
            raise PreviewError("The layout post must be a page of the project's own website.")
        return explicit, _fetch(explicit)
    urls: list[str] = []
    configured = configured_reference(db, b)
    if configured:
        urls.append(configured)
    cards = _cards(BeautifulSoup(list_html, "html.parser"))
    urls += [urljoin(list_url, a["href"]) for c in cards[:6] for a in _anchors(c)[:1]]
    urls += [u for (u,) in db.execute(select(Article.wp_url).where(Article.business_id == b.id, Article.wp_status == "publish", Article.wp_url.is_not(None)).order_by(Article.id.desc()).limit(2))]
    for u in dict.fromkeys(urls):
        try:
            html = _fetch(u)
        except PreviewError:
            continue
        if not _is_error_page(html):  # a post that shows "could not be loaded" or has no text is no design to copy: the next one is tried
            return u, html
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
        if el.name in ("link", "img", "source", "video", "audio"):
            # The preview frame has no origin of its own (it is sandboxed), so a stylesheet or picture that asks for a CORS check (crossorigin, as Vite and many React builds write it)
            # is refused by any site that sends no CORS header, and the page then shows without its design. Without the attribute they load as in a normal page.
            el.attrs.pop("crossorigin", None)
            el.attrs.pop("integrity", None)
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
    head.insert(0, BeautifulSoup(f"<base href='{base}'><meta name='robots' content='noindex'>{REVEAL_CSS}{FILL_CSS}", "html.parser"))


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
def inline_content_images(body: str, business_id: int, article_id: int) -> str:
    """The pictures placed on the Images & Analysis step point at GrowZen (/api/v1/.../content-images/x.webp). Inside the preview they would be looked up on the
    project's website (the page's base address) and need GrowZen's login, so they show as broken. Each one is embedded from its file instead (up to 1.5 MB each).
    Only the preview gets this: the article that is saved and published keeps its normal address."""
    import base64

    from . import content_images as ci

    def swap(m: re.Match) -> str:
        tag = m.group(0)
        path = ci.path_of(business_id, article_id, m.group(1))
        try:
            data = path.read_bytes() if path else b""
        except OSError:
            data = b""
        if not data or len(data) > 1_500_000:
            return tag
        uri = f"data:image/webp;base64,{base64.b64encode(data).decode()}"
        if re.search(r'\bsrc="[^"]*"', tag):
            return re.sub(r'\bsrc="[^"]*"', lambda _m: f'src="{uri}"', tag, count=1)
        return tag[:-1].rstrip("/") + f' src="{uri}">'
    return ci.IMG_RE.sub(swap, body or "")


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


def _hero_image(soup: BeautifulSoup, title_el: Tag | None) -> Tag | None:
    """The post's main picture when no known class names it: the first picture in the block around the title (outside the article text, the header and the footer)."""
    if title_el is None:
        return None
    el = title_el
    for _ in range(5):
        el = el.parent
        if el is None or el.name in ("body", "html"):
            return None
        img = next((i for i in el.find_all("img") if not _inside(i, ("header", "footer", "nav")) and not i.find_parent(class_=re.compile(r"blog-content|entry-content|post-content|growzen-article"))), None)
        if img is not None:
            return img
    return None


_DATE_TEXT = re.compile(r"\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+\d{4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b", re.I)


def _post_head_texts(title_el: Tag | None, excerpt: str) -> None:
    """In the block around the title (outside the article text): the old post's intro line becomes this post's description, and its date becomes today."""
    if title_el is None:
        return
    box = title_el.parent
    for _ in range(3):
        if box is None or box.parent is None or box.parent.name in ("body", "html") or box.parent.find(class_=re.compile(r"blog-content|entry-content|post-content|growzen-article")):
            break
        box = box.parent
    if box is None:
        return
    root = next((p for p in title_el.parents if p.parent is None), None)
    areas = [a for a in (root.select(", ".join(CONTENT_SELECTORS + [".growzen-article", ".elementor-widget-text-editor"])) if root is not None else [])]
    if excerpt:
        lead = next((p for p in title_el.find_all_next("p", limit=4) if box in p.parents and len(p.get_text(strip=True)) > 40
                     and not any(a in p.parents for a in areas)), None)  # never a paragraph of the article itself
        if lead is not None:
            _set_text(lead, excerpt)
    for node in list(box.find_all(string=_DATE_TEXT)):
        node.replace_with(_DATE_TEXT.sub(datetime.now().strftime("%d %B %Y").lstrip("0"), str(node)))


_TOC_LABEL = re.compile(r"^\s*(in this (article|post|guide)|table of contents|contents|on this page)\s*$", re.I)


def _rebuild_toc(soup: BeautifulSoup) -> None:
    """The site's own "In this article" list still names the old post's sections: rebuilt from this article's H2s, in the site's style (its first item is the model)."""
    area = _first(soup, CONTENT_SELECTORS + [".growzen-article"])
    heads = [h for h in (area.find_all("h2") if area is not None else []) if h.get_text(strip=True)]
    label = next((t for t in soup.find_all(string=_TOC_LABEL) if area is None or area not in t.parents), None)
    if label is None or not heads:
        return
    box = label.parent
    links: list[Tag] = []
    for _ in range(4):
        if box is None:
            return
        links = [a for a in box.find_all("a", href=True) if a["href"].startswith("#")]
        if len(links) >= 2:
            break
        box = box.parent
    if len(links) < 2:
        return
    item = links[0]
    while item.parent is not None and item.parent is not box and len([a for a in item.parent.find_all("a", href=True) if a["href"].startswith("#")]) == 1:
        item = item.parent  # the repeated unit: the link itself or its <li>
    holder = item.parent
    model = copy.copy(item)
    for el in [x for x in holder.find_all(recursive=False) if x.find("a", href=lambda h: h and h.startswith("#")) or (x.name == "a" and str(x.get("href", "")).startswith("#"))]:
        el.decompose()
    for i, h in enumerate(heads[:12], 1):
        hid = h.get("id") or f"gz-sec-{i}"
        h["id"] = hid
        new = copy.copy(model)
        a = new if new.name == "a" else new.find("a", href=True)
        a["href"] = f"#{hid}"
        texts = [s for s in new.find_all(string=True) if s.strip()]
        nums = [s for s in texts if re.fullmatch(r"\s*\d{1,2}\.?\s*", s)]
        for s in nums[:1]:
            s.replace_with(f"{i:02d}" if len(s.strip().rstrip(".")) == 2 else str(i))
        words = [s for s in new.find_all(string=True) if s.strip() and not re.fullmatch(r"\s*\d{1,2}\.?\s*", s)]
        if words:
            longest = max(words, key=len)
            longest.replace_with(h.get_text(" ", strip=True))
            for s in words:
                if s is not longest:
                    s.replace_with("")
        holder.append(new)


def render_post(page: str, base: str, *, title: str, body_html: str, image: str | None, notes: list[str], mark=None, excerpt: str = "") -> str:
    mark = mark or (lambda h: h)  # colours the keywords in a piece of HTML (the identity when the preview is plain)
    soup = BeautifulSoup(page, "html.parser")
    _clean(soup, base)
    title_el = _first(soup, TITLE_SELECTORS)
    wrapper_open = "<div class='growzen-article growzen-fill'>"
    done = _render_elementor(soup, body_html, mark, notes)

    texts = [e for e in soup.select(".elementor-widget-text-editor") if not _inside(e, ("header", "footer", "nav"))]
    area = _first(soup, CONTENT_SELECTORS)
    if not done and area is not None and len(area.get_text(" ", strip=True)) >= 150 and not texts:
        area.clear()
        area["class"] = [*(area.get("class") or []), "growzen-fill"]
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
            main.append(BeautifulSoup(f"<div class='growzen-article growzen-fill' style='max-width:820px;margin:0 auto;padding:24px 16px'>{mark(article_html(body_html, drop_h1=False))}</div>", "html.parser"))
            notes.append("Placed in the site's main content area.")
        elif soup.body is not None:
            keep_tags = [c for c in soup.body.find_all(recursive=False) if c.name in ("header", "footer", "nav", "style") or c.get("data-elementor-type") in ("header", "footer")]
            for c in list(soup.body.find_all(recursive=False)):
                if c not in keep_tags:
                    c.decompose()
            holder = BeautifulSoup(f"<main class='growzen-article growzen-fill' style='max-width:820px;margin:0 auto;padding:32px 16px'>{mark(article_html(body_html, drop_h1=False))}</main>", "html.parser")
            foot = next((c for c in keep_tags if c.name == "footer" or c.get("data-elementor-type") == "footer"), None)
            (foot.insert_before(holder) if foot is not None else soup.body.append(holder))
            notes.append("Placed between the site's header and footer.")
    # title, picture, date
    t = _first(soup, TITLE_SELECTORS)
    if t is not None and title:
        _set_text(t, title)
    _post_head_texts(t, excerpt)
    try:
        _rebuild_toc(soup)
    except Exception:  # noqa: BLE001 - an unusual contents list is left as it is rather than breaking the preview
        pass
    if soup.title is not None and title:
        soup.title.string = title
    if image:
        img = _first(soup, IMAGE_SELECTORS) or _hero_image(soup, t)
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
def render_list(page: str, base: str, *, title: str, excerpt: str, image: str | None, url: str, notes: list[str], tag: str = "") -> str:
    soup = BeautifulSoup(page, "html.parser")
    _clean(soup, base)
    cards = _cards(soup)
    if not cards:
        raise PreviewError("The site's blog page has no readable post cards.")
    first = cards[0]
    new = copy.copy(first)
    classes = [c for c in (new.get("class") or []) if not re.fullmatch(r"post-\d+|category-.*|tag-.*", c)]
    new["class"] = classes
    for a in _anchors(new):
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
    now = datetime.now()
    for node in list(new.find_all(string=re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b"))):  # a numeric date (11/19/2026, 19-11-2026) in the clone: today, in the same order and separator
        m = re.search(r"\b(\d{1,2})([/.-])(\d{1,2})[/.-](\d{4})\b", str(node))
        day_first = int(m.group(1)) > 12  # 19-11-2026 is day first; 11/19/2026 is month first (an ambiguous 05/06/2026 is read month first)
        part1, part2 = (now.day, now.month) if day_first else (now.month, now.day)
        text = f"{part1:02d}{m.group(2)}{part2:02d}{m.group(2)}{now.year}"
        node.replace_with(str(node).replace(m.group(0), text))
    if tag:  # the small category label over the picture: this post's topic, not the old post's
        label = next((e for e in new.find_all(True) if "absolute" in (e.get("class") or []) and not e.find(["img", "h2", "h3", "h4"]) and 3 <= len(e.get_text(strip=True)) <= 40), None)
        node = next((s for s in label.find_all(string=True) if s.strip()), None) if label is not None else None
        if node is not None:  # only the words: the pill (its own element, colours and icon) stays as the site draws it
            node.replace_with(tag.upper() if node.strip().isupper() else tag)
    new["style"] = (new.get("style", "") + ";outline:3px solid #4f46e5;outline-offset:2px;position:relative").lstrip(";")
    new.insert(0, BeautifulSoup("<span style='position:absolute;top:8px;right:8px;z-index:9;background:#4f46e5;color:#fff;font:600 11px/1 sans-serif;padding:5px 9px;border-radius:999px'>Your new post</span>", "html.parser"))
    first.insert_before(new)
    cards[-1].decompose() if len(cards) >= 4 else None  # the newest post takes the place of the oldest on the first page
    notes.append(f"Added to your site's blog page as its newest post ({len(cards)} cards found).")
    return "<!doctype html>" + str(soup)


# ------------------------------------------------------------------------------------------------------------------------ the entry point
def build(db: Session, b: Business, a: Article, *, view: str, title: str, excerpt: str, body: str, image: str | None, url: str,
          primary: str | None, secondary: list[str], highlight: bool, reference_url: str | None = None) -> dict:
    """The page as the site would show it with this article. When the site's own pages cannot be copied (a site that draws its blog with JavaScript, or a blog page
    that cannot be found), a page in the site's brand is drawn instead (site_preview_brand) and says so. Raises PreviewError only when neither can be built."""
    mark = (lambda h: mark_keywords(h, primary, secondary)) if highlight else (lambda h: h)
    body = inline_content_images(body, b.id, a.id)  # the pictures placed on the Images & Analysis step show in the preview
    ps = publish_site(db, b)
    info = {"host": ps["host"], "label": ps["label"], "from_setup": ps["from_setup"], "site": ps["site"]}  # which website this preview is of, and whether Publishing Setup named it
    try:
        out = _build_copy(db, b, view=view, title=title, excerpt=excerpt, body=body, image=image, url=url, mark=mark, reference_url=reference_url, primary=primary)
    except PreviewError as exc:
        if reference_url:  # a post the user chose: say why it could not be used
            raise
        from . import site_preview_brand as brand
        if not ps["site"]:
            raise
        out = brand.render(db, b, a, view=view, title=title, excerpt=excerpt, body_html=body, image=image, url=url, reason=str(exc), mark=mark, site_url=ps["site"])
    out["site"] = info
    return out


def _build_copy(db: Session, b: Business, *, view: str, title: str, excerpt: str, body: str, image: str | None, url: str, mark, reference_url: str | None, primary: str | None = None) -> dict:
    list_url, list_html = listing_page(db, b)
    notes: list[str] = []
    if view == "list":
        html = render_list(list_html, list_url, title=title, excerpt=excerpt, image=image, url=url, notes=notes, tag=(primary or "").strip())
        return {"html": html, "reference_url": list_url, "view": "list", "notes": notes}
    ref_url, ref_html = reference_post(db, b, list_url, list_html, reference_url)
    html = render_post(ref_html, ref_url, title=title, body_html=body, image=image, notes=notes, mark=mark, excerpt=excerpt)
    notes.append(f"Design read from {ref_url}.")
    return {"html": html, "reference_url": ref_url, "view": "post", "notes": notes}
