"""Publish GrowZen articles in the website's own Elementor blog design.

Why: on Elementor sites like codigix.co (Hello Elementor theme) there is no shared single-post template. Each blog post
is laid out in Elementor (title, date, featured image, heading/text sections, CTA box, Recent Blogs, FAQ accordion,
testimonials, ...). A post sent as plain HTML falls back to the bare theme page: a duplicate H1, no featured image,
no CTA or Recent Blogs, unstyled text.

What this does: it reads the layout of an existing Elementor-built blog post on the site (the "layout reference"),
keeps every part of it (header/footer template, title + date + featured image widgets, CTA box, sidebar, Recent Blogs,
testimonials, styles) and replaces only the article content:
  - the reference's own heading/text sections  -> this article's sections (H2 headings + text with H3, lists, links)
  - the FAQ accordion items                     -> this article's FAQs (the accordion is dropped when there are none)
  - the JSON-LD schema                          -> an HTML widget at the end of the content
So every published article looks exactly like the hand-built posts and follows the design if it changes. If no
Elementor-built post exists on the site, publishing falls back to clean HTML (without a duplicate H1).
"""
import copy
import hashlib
import html as html_lib
import json
import logging
import re

log = logging.getLogger("seo.elementor_layout")

CONTENT_WIDGETS = ("heading", "text-editor")
_SCHEMA_RE = re.compile(r"\s*<script\b[^>]*type=[\"']application/ld\+json[\"'][^>]*>[\s\S]*?</script>\s*", re.I)
_FAQ_H2 = re.compile(r"^\s*(frequently asked questions|faqs?)\b", re.I)
_CTA_H2 = re.compile(r"^\s*(ready to get started|contact\b|get in touch)", re.I)


# ── clean HTML (also used without Elementor) ────────────────────────────────────

def clean_body(body: str) -> str:
    """Article HTML for WordPress: no H1 (the theme/Elementor prints the title), no empty tags, no inline styles,
    no runs of blank lines. Headings, paragraphs, lists, links, bold/italic and the schema script are kept."""
    b = body or ""
    b = re.sub(r"^\s*<h1\b[^>]*>[\s\S]*?</h1>\s*", "", b, count=1, flags=re.I)  # the title is rendered by the site
    b = re.sub(r"<h1\b([^>]*)>([\s\S]*?)</h1>", r"<h2\1>\2</h2>", b, flags=re.I)  # any other H1 becomes an H2
    scripts = _SCHEMA_RE.findall(b)
    b = _SCHEMA_RE.sub("\n", b)
    b = re.sub(r"\s(style|class)=\"[^\"]*\"", "", b, flags=re.I)  # the site's CSS styles the article, not inline CSS
    b = re.sub(r"<(p|li|h[2-6]|strong|em|span)>\s*(?:&nbsp;|\s)*</\1>", "", b, flags=re.I)  # empty tags
    b = re.sub(r"(?:<br\s*/?>\s*){2,}", "<br>", b, flags=re.I)
    b = re.sub(r"\n{3,}", "\n\n", b).strip()
    return b + ("\n\n" + "\n".join(s.strip() for s in scripts) if scripts else "")


def split_sections(body: str) -> tuple[str, list[tuple[str, str]], str]:
    """(intro_html, [(h2_title, section_html), ...], schema_script) from a cleaned body."""
    schema = "\n".join(s.strip() for s in _SCHEMA_RE.findall(body or ""))
    b = _SCHEMA_RE.sub("\n", body or "")
    parts = re.split(r"<h2\b[^>]*>([\s\S]*?)</h2>", b, flags=re.I)
    intro = parts[0].strip()
    sections = [(html_lib.unescape(re.sub(r"<[^>]+>", "", parts[i])).strip(), parts[i + 1].strip()) for i in range(1, len(parts) - 1, 2)]
    return intro, sections, schema


def _text(h: str) -> str:
    return " ".join(html_lib.unescape(re.sub(r"<[^>]+>", " ", h or "")).split())


def faqs_from(section_html: str) -> list[tuple[str, str]]:
    """(question, answer_html) pairs from a FAQ section: each <h3> and the HTML after it."""
    out = []
    for q, a in re.findall(r"<h3\b[^>]*>([\s\S]*?)</h3>([\s\S]*?)(?=<h3\b|$)", section_html or "", re.I):
        if _text(q) and _text(a):
            out.append((_text(q), a.strip()))
    return out


# ── Elementor document ─────────────────────────────────────────────────────────

def _walk(nodes, parents=()):
    for n in nodes or []:
        yield n, parents
        yield from _walk(n.get("elements"), parents + (n,))


def is_layout(data: list) -> bool:
    """An Elementor post document usable as the blog layout: it has the post title widget and heading/text sections."""
    kinds = [n.get("widgetType") for n, _ in _walk(data)]
    return "theme-post-title" in kinds and kinds.count("heading") >= 2 and "text-editor" in kinds


def _content_column(data: list) -> dict | None:
    """The container holding the article sections: most direct heading/text-editor children (featured image preferred)."""
    best, score = None, 0
    for n, _ in _walk(data):
        kids = n.get("elements") or []
        s = sum(1 for k in kids if k.get("widgetType") in CONTENT_WIDGETS)
        if any(k.get("widgetType") == "theme-post-featured-image" for k in kids):
            s += 2
        if s > score:
            best, score = n, s
    return best if score >= 2 else None


class _Ids:
    """Stable element ids per article, so a re-publish keeps the same ids (Elementor's generated CSS stays valid)."""
    def __init__(self, seed: str, taken: set[str]):
        self.seed, self.n, self.taken = seed, 0, set(taken)

    def __call__(self) -> str:
        while True:
            self.n += 1
            i = hashlib.sha1(f"{self.seed}:{self.n}".encode()).hexdigest()[:7]
            if i not in self.taken:
                self.taken.add(i)
                return i


def _renew_ids(node: dict, new_id) -> dict:
    node = copy.deepcopy(node)
    for n, _ in _walk([node]):
        n["id"] = new_id()
    return node


def build(layout: list, *, article_key: str, body: str, faqs: list[tuple[str, str]] | None = None) -> tuple[list, dict]:
    """The Elementor data for one article from the layout reference's data. Returns (data, report)."""
    data = copy.deepcopy(layout)
    taken = {n.get("id") for n, _ in _walk(data)}
    new_id = _Ids(article_key, taken)
    col = _content_column(data)
    if col is None:
        raise ValueError("The layout reference has no heading/text content column")

    kids = col.get("elements") or []
    first = next(i for i, k in enumerate(kids) if k.get("widgetType") in CONTENT_WIDGETS)
    head_tpl = next((k for k in kids if k.get("widgetType") == "heading"), None)
    text_tpl = next((k for k in kids if k.get("widgetType") == "text-editor"), None)
    has_cta = any(n.get("widgetType") == "button" for n, _ in _walk(kids))
    kept_before = [k for k in kids[:first] if k.get("widgetType") not in CONTENT_WIDGETS]
    kept_after = [k for k in kids[first:] if k.get("widgetType") not in CONTENT_WIDGETS]  # CTA box etc.

    intro, sections, schema = split_sections(body)
    accordion = next((n for n, _ in _walk(data) if n.get("widgetType") == "nested-accordion"), None)
    faq_items = list(faqs) if faqs is not None else None  # None: read the FAQs from the article's FAQ section
    widgets, dropped = [], []

    def heading(title: str) -> dict:
        w = _renew_ids(head_tpl, new_id)
        w["settings"] = {**w.get("settings", {}), "title": title, "header_size": "h2"}
        return w

    def text(h: str) -> dict:
        w = _renew_ids(text_tpl, new_id)
        w["settings"] = {**w.get("settings", {}), "editor": h}
        return w

    if _text(intro):
        widgets.append(text(intro))
    for title, sec in sections:
        if _FAQ_H2.match(title):
            if accordion is not None:  # shown in the site's FAQ accordion instead
                faq_items = faq_items if faq_items is not None else faqs_from(sec)
                dropped.append(title)
                continue
        elif has_cta and _CTA_H2.match(title):  # the layout's own CTA box replaces the article's contact block
            dropped.append(title)
            continue
        widgets.append(heading(title))
        if _text(sec):
            widgets.append(text(sec))
    faq_items = faq_items or []
    if schema:
        widgets.append({"id": new_id(), "elType": "widget", "widgetType": "html", "settings": {"html": schema}, "elements": []})
    col["elements"] = kept_before + widgets + kept_after

    # FAQ accordion: this article's questions, or no FAQ block at all
    if accordion is not None:
        if faq_items:
            items_tpl = (accordion.get("settings") or {}).get("items") or [{}]
            child_tpl = (accordion.get("elements") or [None])[0]
            items, children = [], []
            for q, a in faq_items:
                it = {**copy.deepcopy(items_tpl[0]), "item_title": q, "_id": new_id()}
                items.append(it)
                if child_tpl is not None:
                    ch = _renew_ids(child_tpl, new_id)
                    for n, _ in _walk([ch]):
                        if n.get("widgetType") == "text-editor":
                            n["settings"] = {**n.get("settings", {}), "editor": a if a.lstrip().startswith("<") else f"<p>{html_lib.escape(a)}</p>"}
                            break
                    children.append(ch)
            accordion["settings"] = {**accordion.get("settings", {}), "items": items}
            accordion["elements"] = children
        else:
            # drop the whole top-level FAQ block (heading + accordion)
            for top in data:
                if any(n is accordion for n, _ in _walk([top])):
                    data.remove(top)
                    break
    report = {"sections": sum(1 for w in widgets if w.get("widgetType") == "heading"), "faqs": len(faq_items) if accordion is not None else 0,
              "moved_to_layout": dropped, "schema": bool(schema)}
    return data, report


# ── finding the layout reference on the site ───────────────────────────────────

def find_reference(client, base: str, auth, *, preferred_id: str | None = None, exclude_ids: set[str] | None = None) -> dict | None:
    """The newest published Elementor-built blog post (or `preferred_id`) whose document is a usable layout.
    Returns {id, title, link, data, categories} or None. Posts GrowZen published itself are skipped."""
    exclude = {str(x) for x in (exclude_ids or set()) if x}
    candidates = []
    if preferred_id and str(preferred_id).isdigit():
        r = client.get(f"{base}/wp-json/wp/v2/posts/{preferred_id}", params={"context": "edit"}, auth=auth)
        if r.status_code == 200:
            candidates.append(r.json())
    r = client.get(f"{base}/wp-json/wp/v2/posts", params={"context": "edit", "status": "publish", "per_page": 20, "orderby": "date", "order": "desc"}, auth=auth)
    if r.status_code == 200:
        candidates += r.json()
    for p in candidates:
        if str(p.get("id")) in exclude and str(p.get("id")) != str(preferred_id):
            continue
        meta = p.get("meta") or {}
        if meta.get("_elementor_edit_mode") != "builder":
            continue
        try:
            data = json.loads(meta.get("_elementor_data") or "[]")
        except ValueError:
            continue
        if isinstance(data, list) and is_layout(data):
            return {"id": p.get("id"), "title": html_lib.unescape(re.sub(r"<[^>]+>", "", (p.get("title") or {}).get("rendered", ""))),
                    "link": p.get("link"), "data": data, "categories": p.get("categories") or [], "template": p.get("template") or "elementor_header_footer",
                    "page_settings": meta.get("_elementor_page_settings")}
    return None
