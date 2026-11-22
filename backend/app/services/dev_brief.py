"""The developer brief: one document a developer can work from to put the keyword changes on the website.

For every page that has keywords mapped to it, three short lists, in the order a developer works:
  1. META DATA (goes in the page's <head>): the page title and the meta description: the text there now, and the text to replace it with (or to add, when the page has none).
  2. REPLACE existing content: the heading or paragraph that is on the page now (find this), and what to replace it with.
  3. ADD NEW content: what does not exist yet (a new section, a new paragraph, a heading, image text), what to write, and where on the page to put it.
After the pages: the keywords that still have no page, notes for the whole site, and what to check when it is done. Everything comes from the page overview (the page read live), so what the document says is what
the page says today. The text proposed is only what the software could write from the business's own facts: the developer or the owner reads it before it goes live.

Two formats from the same data: PDF (to send) and Markdown (to paste into a ticket).
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from io import BytesIO
from typing import Any
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, IndexPage, Keyword
from . import keyword_mapping as km
from . import keyword_placement as kp
from .gsc import host_of

META_PLACES = {"title": "Page title (the <title> tag in the head)", "description": "Meta description (the description meta tag in the head)"}
REPLACE_PLACES = {"heading": "Main heading (H1)", "intro": "First paragraph", "image": "Image text (alt)"}
WHERE_NEW = {"heading": "Put it at the top of the page content as the one main heading (H1).", "intro": "Put it directly under the main heading, as the first paragraph.",
             "image": "Use it as the alt text of the first image on the page.", "section": "Add it as a new section after the existing content, above the footer: the heading first, then the paragraph under it."}
MAX_PAGES = 15


def _path(url: str) -> str:
    return (urlsplit(url).path or "/").rstrip("/") or "/"


def _page(business_id: int, url: str, focus: str | None) -> dict[str, Any]:
    """One page's overview, in its own database session (pages are read side by side)."""
    from ..db import SessionLocal
    db = SessionLocal()
    try:
        b = db.get(Business, business_id)
        return kp.page_detail(db, b, url, focus)
    except kp.PlacementError as exc:
        return {"url": url, "path": _path(url), "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - one page that cannot be read must not stop the document
        return {"url": url, "path": _path(url), "error": f"The page could not be read ({str(exc)[:80]})."}
    finally:
        db.close()


def sort_changes(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """The page's suggestions as the three lists a developer works through. rows: {place, current, new, keyword, why}.
    A section heading and the paragraph for the same keyword become one new section."""
    meta, replace, add = [], [], []
    sections: dict[str, dict[str, Any]] = {}
    for r in rows:
        place, cur = r["place"], (r.get("current") or "").strip()
        if place in META_PLACES:
            meta.append({"element": META_PLACES[place], "action": "REPLACE" if cur else "ADD", "current": cur, "new": r["new"], "keyword": r["keyword"], "why": r.get("why", "")})
        elif place in REPLACE_PLACES and cur:
            replace.append({"element": REPLACE_PLACES[place], "current": cur, "new": r["new"], "keyword": r["keyword"], "why": r.get("why", "")})
        elif place in ("subheading", "text"):
            s = sections.setdefault(r["keyword"], {"kind": "section", "keyword": r["keyword"], "heading": "", "paragraph": "", "why": r.get("why", "")})
            s["heading" if place == "subheading" else "paragraph"] = r["new"]
        else:
            add.append({"kind": "single", "element": REPLACE_PLACES.get(place, place), "place": place, "new": r["new"], "keyword": r["keyword"], "why": r.get("why", "")})
    add = [{**s, "element": "New section", "place": "section"} for s in sections.values()] + add
    meta.sort(key=lambda m: 0 if "title" in m["element"].lower() else 1)
    return {"meta": meta, "replace": replace, "add": add}


def collect_page(db: Session, b: Business, page: str, focus: str | None = None) -> dict[str, Any]:
    """The document for ONE page: exactly what its overview shows (the keywords that belong on it, what it says now, what to replace or add) and nothing about the rest of the site."""
    host = host_of(b.website)
    url = page if page.startswith("http") else f"https://{host}{page if page.startswith('/') else '/' + page}"
    if host and host_of(url) != host:
        raise kp.PlacementError("Only pages of this project's own website can be put in the document.")
    read = _page(b.id, url, focus)
    entry: dict[str, Any] = {"path": _path(url), "url": url, "keywords": [], "meta": [], "replace": [], "add": [], "notes": [], "count": 0}
    vol = {k.keyword: k.volume for k in db.scalars(select(Keyword).where(Keyword.business_id == b.id))}
    if read.get("error"):
        entry["notes"].append(read["error"])
    else:
        entry["scope"] = read["scope"]["label"]
        entry["notes"] += list(read.get("notes", []))
        entry["now"] = {"title": read.get("title") or "", "description": read.get("description") or "", "h1": read.get("h1") or [], "headings": read.get("headings") or [], "words": read.get("words", 0)}
        rows = []
        for r in read["keywords"]:
            entry["keywords"].append({"keyword": r["keyword"], "role": "primary" if r["role"] == "main" else "secondary", "volume": r.get("volume") or vol.get(r["keyword"])})
            if r.get("warning"):
                entry["notes"].append(f"\"{r['keyword']}\": {r['warning']}")
                continue
            rows += [{"place": a["place"], "current": a.get("current"), "new": a["example"], "keyword": r["keyword"], "why": a["why"]} for a in r["to_add"] if a.get("example")]
        entry.update(sort_changes(rows))
    entry["count"] = len(entry["meta"]) + len(entry["replace"]) + len(entry["add"])
    site_notes = []
    row = db.scalar(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url.in_([url, url.rstrip("/"), url.rstrip("/") + "/"])))
    if row is not None and row.g_state == "not_indexed":
        site_notes.append(f"Google has not indexed this page yet ({row.g_reason or 'not indexed'}). A page Google does not index cannot rank for its keywords.")
    t_ = {"pages": 1, "changes": entry["count"], "meta": len(entry["meta"]), "replace": len(entry["replace"]), "add": len(entry["add"]), "keywords": len(entry["keywords"])}
    return {"single": True, "business": b.name, "website": b.website, "date": date.today().isoformat(), "pages": [entry], "missing": [], "unmapped": [], "site_notes": site_notes, "totals": t_}


def collect(db: Session, b: Business, only_page: str | None = None, focus: str | None = None) -> dict[str, Any]:
    if only_page:
        return collect_page(db, b, only_page, focus)
    host = host_of(b.website)
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    kws.sort(key=lambda k: (-(k.volume or 0), k.keyword))
    by_page: dict[str, list[Keyword]] = {}
    urls: dict[str, str] = {}
    for k in kws:
        if not k.target_url:
            continue
        full = k.target_url if k.target_url.startswith("http") else f"https://{host}{k.target_url if k.target_url.startswith('/') else '/' + k.target_url}"
        if host and host_of(full) != host:
            continue
        by_page.setdefault(_path(full), []).append(k)
        urls[_path(full)] = full
    if only_page:
        want = _path(only_page if only_page.startswith("http") else f"https://{host}{only_page}")
        by_page = {p: v for p, v in by_page.items() if p == want}
        if want not in by_page:  # a page with no keyword mapped to it: its suggestions still come from the mapping
            by_page[want] = []
            urls[want] = only_page if only_page.startswith("http") else f"https://{host}{want}"
    order = sorted(by_page, key=lambda p: -sum(k.volume or 0 for k in by_page[p]))[:MAX_PAGES]
    with ThreadPoolExecutor(max_workers=4) as pool:
        reads = list(pool.map(lambda p: _page(b.id, urls[p], next((k.keyword for k in by_page[p] if k.role == "primary"), by_page[p][0].keyword if by_page[p] else None)), order))
    pages = []
    for path, read in zip(order, reads):
        entry: dict[str, Any] = {"path": path, "url": urls[path], "keywords": [{"keyword": k.keyword, "role": k.role or "", "volume": k.volume} for k in by_page[path]],
                                 "meta": [], "replace": [], "add": [], "notes": []}
        if read.get("error"):
            entry["notes"].append(read["error"])
        else:
            entry["scope"] = read["scope"]["label"]
            entry["notes"] += list(read.get("notes", []))
            rows = []
            for r in read["keywords"]:
                if r.get("warning"):
                    entry["notes"].append(f"\"{r['keyword']}\": {r['warning']}")
                    continue
                rows += [{"place": a["place"], "current": a.get("current"), "new": a["example"], "keyword": r["keyword"], "why": a["why"]} for a in r["to_add"] if a.get("example")]
            entry.update(sort_changes(rows))
        entry["count"] = len(entry["meta"]) + len(entry["replace"]) + len(entry["add"])
        pages.append(entry)
    plan = km.plan(db, b)
    missing = [{"keyword": m["keyword"], "volume": m.get("volume"), "kind": "Page", "address": m.get("slug"), "title": m.get("title")} for m in plan.get("missing_pages", [])]
    missing += [{"keyword": m["keyword"], "volume": m.get("volume"), "kind": "Blog post", "address": m.get("slug"), "title": m.get("title")} for m in plan.get("blog_opportunities", [])]
    unmapped = [k.keyword for k in kws if not k.target_url]
    site_notes = list(plan.get("notes", []))
    not_indexed = [_path(p.url) for p in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.g_state == "not_indexed"))]
    if not_indexed:
        site_notes.append(f"Google has not indexed these pages yet: {', '.join(not_indexed[:8])}. A page Google does not index cannot rank for its keywords.")
    if any("canonical" in n for e in pages for n in e["notes"]):
        site_notes.append("Some pages point their canonical tag at another page: each page should name itself as canonical.")
    return {"business": b.name, "website": b.website, "date": date.today().isoformat(), "pages": pages, "missing": missing, "unmapped": unmapped, "site_notes": site_notes,
            "totals": {"pages": len(pages), "changes": sum(p["count"] for p in pages), "meta": sum(len(p["meta"]) for p in pages), "replace": sum(len(p["replace"]) for p in pages),
                       "add": sum(len(p["add"]) for p in pages), "keywords": len(kws)}}


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _scope(d: dict[str, Any]) -> str:
    t = d["totals"]
    parts = f"{_plural(t['meta'], 'meta data change', 'meta data changes')}, {_plural(t['replace'], 'text to replace', 'texts to replace')}, {_plural(t['add'], 'new thing to add', 'new things to add')}"
    return ("This page only: " if d.get("single") else f"{_plural(t['pages'], 'page', 'pages')}: ") + parts


def _intro(d: dict[str, Any]) -> str:
    where = "this page" if d.get("single") else "each page"
    return (f"This document lists what to change on {where} so the chosen keywords are on {'the right page' if d.get('single') else 'the right pages'}. The proposed text is a draft written from the business's own facts: "
            "read each line and change it so it is true before it goes live.")


NO_PARAGRAPH = "not drafted: write two plain sentences under the heading about this, using the keyword once."
STEPS = ["Open each page below and make the changes in the order given: meta data first, then the text to replace, then the new content to add.",
         "REPLACE means: find the text shown under Find and swap it for the text under Replace with. ADD NEW means there is nothing there now: add it where it says.",
         "Keep one main heading (H1) per page and write for people first: use the keyword once or twice, in plain words.",
         "Publish, then open the page and check each change is there.",
         "In Search Console, use URL Inspection > Request indexing for each changed page, and tell the owner so the software can re-check the pages."]


STEPS_PAGE = ["Make the changes below on this one page, in the order given: meta data first, then the text to replace, then the new content to add.",
              "REPLACE means: find the text shown under Find and swap it for the text under Replace with. ADD NEW means there is nothing there now: add it where it says.",
              "Keep one main heading (H1) on the page and write for people first: use each keyword once or twice, in plain words.",
              "Publish, open the page and check each change is there, then request indexing for it in Search Console (URL Inspection > Request indexing)."]


def _now_md(p: dict[str, Any]) -> list[str]:
    n = p.get("now")
    if not n:
        return []
    return ["### What the page says now", "", f"- Title: {n['title'] or '(none)'}", f"- Description: {n['description'] or '(none)'}", f"- Main heading (H1): {' | '.join(n['h1']) or '(none)'}",
            f"- Section headings: {' | '.join(n['headings']) or '(none)'}", ""]


def render_md(d: dict[str, Any]) -> str:
    t = d["totals"]
    single = d.get("single")
    legend = "In the text to use, the **bold** words are the keyword for that change and the _italic_ words are the page's other keywords: keep them in."
    steps = STEPS_PAGE if single else STEPS
    out = [f"# SEO content changes: {d['pages'][0]['path'] if single else d['business']}" + (f" ({d['business']})" if single else ""), "", f"Website: {d['website']}  ", f"Prepared: {d['date']}  ",
           f"{_scope(d)}.", "", _intro(d), "",
           "## How to work through it", ""] + [f"{i}. {s}" for i, s in enumerate(steps, 1)] + ["", legend, ""]
    if d["site_notes"]:
        out += ["## " + ("About this page" if single else "Notes for the whole site"), ""] + [f"- {n}" for n in d["site_notes"]] + [""]
    for p in d["pages"]:
        page_kw = [k["keyword"] for k in p["keywords"]]
        H = lambda text, kw: hl_md(text, [kw], page_kw)  # noqa: E731
        out += [f"## Page: {p['path']}", "", f"Address: {p['url']}  "]
        if p.get("scope"):
            out.append(f"Page type: {p['scope']}  ")
        if p["keywords"]:
            out.append("Keywords: " + "; ".join(f"**{k['keyword']}**{' (primary)' if k['role'] == 'primary' else ' (secondary)' if k['role'] == 'secondary' else ''}{f', {k['volume']:,} searches/month' if k.get('volume') else ''}" for k in p["keywords"]))
        out.append("")
        out += _now_md(p)
        n = 0
        if p["meta"]:
            out += ["### Meta data (goes in the page's head)", ""]
            for m in p["meta"]:
                n += 1
                out += [f"- [ ] **{m['element']}: {m['action']}**"]
                out += ([f"  - Find: `{m['current']}`", f"  - Replace with: {H(m['new'], m['keyword'])}"] if m["current"] else ["  - Now: nothing", f"  - Add: {H(m['new'], m['keyword'])}"]) + [f"  - For keyword: **{m['keyword']}**", ""]
        if p["replace"]:
            out += ["### Replace existing content", ""]
            for r in p["replace"]:
                n += 1
                out += [f"- [ ] **{r['element']}: REPLACE**", f"  - Find: `{r['current']}`", f"  - Replace with: {H(r['new'], r['keyword'])}", f"  - For keyword: **{r['keyword']}**", ""]
        if p["add"]:
            out += ["### Add new content", ""]
            for a in p["add"]:
                n += 1
                out.append(f"- [ ] **{a['element']}: ADD NEW**")
                if a["kind"] == "section":
                    out += ([f"  - Section heading (H2): {H(a['heading'], a['keyword'])}"] if a["heading"] else []) + [f"  - Paragraph under it: {H(a['paragraph'], a['keyword'])}" if a["paragraph"] else f"  - Paragraph under it: {NO_PARAGRAPH}"]
                else:
                    out.append(f"  - Text: {H(a['new'], a['keyword'])}")
                out += [f"  - Where: {WHERE_NEW.get(a['place'], 'Add it where it fits on the page.')}", f"  - For keyword: **{a['keyword']}**", ""]
        if not n:
            out += ["No text changes were found for this page.", ""]
        out += [f"Note: {x}" for x in p["notes"]] + ([""] if p["notes"] else [])
    if d["missing"] or d["unmapped"]:
        out += ["## Keywords that still need a page (ADD NEW)", ""]
        if d["missing"]:
            out += ["| Keyword | Make a | Suggested address | Suggested title |", "|---|---|---|---|"] + [f"| {m['keyword']} | {m['kind']} | {m['address']} | {m['title']} |" for m in d["missing"]]
            out.append("")
        left = [k for k in d["unmapped"] if k not in {m["keyword"] for m in d["missing"]}]
        if left:
            out += ["Chosen but not yet mapped to a page: " + ", ".join(left[:40]) + ".", ""]
    out += ["## When it is done", "", "- [ ] Every change above is on the live page", "- [ ] Indexing requested in Search Console for each changed page", "- [ ] The owner has been told, so the software can re-check the pages", ""]
    return "\n".join(out)


_STOP = {"in", "near", "me", "the", "best", "top", "for", "a", "an", "of", "and", "to", "at", "on", "with", "by", "cheap", "affordable", "my", "your", "nearby", "online", "is", "are", "how", "what"}


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def _keyset(keywords: list[str]) -> set[str]:
    return {_stem(w) for k in keywords for w in re.findall(r"[a-z0-9']+", str(k or "").lower())} - _STOP


def _mark(text: Any, focus: list[str], others: list[str], fmt) -> str:
    """The words of the keywords in a text, marked by `fmt(token, strong)`: the keyword the change is for strongly, the page's other keywords lightly."""
    f, o = _keyset(focus), _keyset(others) - _keyset(focus)
    out = []
    for tok in re.split(r"(\s+)", str(text or "")):
        w = _stem(re.sub(r"^[^a-z0-9']+|[^a-z0-9']+$", "", tok.lower()))
        out.append(fmt(tok, True) if w and w in f else fmt(tok, False) if w and w in o else fmt(tok, None))
    return "".join(out)


def hl_md(text: Any, focus: list[str], others: list[str]) -> str:
    """Markdown: the keyword words in bold, the page's other keywords in italics."""
    return _mark(text, focus, others, lambda tok, strong: tok if strong is None else f"**{tok}**" if strong else f"_{tok}_")


def hl_pdf(text: Any, focus: list[str], others: list[str]) -> str:
    """PDF paragraph markup: the keyword words on yellow, the page's other keywords on lilac. Text is made safe for Helvetica and escaped first."""
    return _mark(_safe(text), focus, others, lambda tok, strong: escape(tok) if strong is None else f'<font backColor="{"#fde68a" if strong else "#e0e7ff"}">{escape(tok)}</font>')


def _safe(s: Any) -> str:
    """Helvetica draws Latin text only: other characters become a plain stand-in rather than a broken box."""
    s = str(s or "").replace("–", "-").replace("—", "-").replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"').replace("…", "...").replace("·", "-")
    return s.encode("latin-1", "replace").decode("latin-1")


def render_pdf(d: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=st["BodyText"], fontSize=8.8, leading=11.4)
    smallb = ParagraphStyle("smallb", parent=small, fontName="Helvetica-Bold")
    label = ParagraphStyle("label", parent=small, fontName="Helvetica-Bold", textColor=colors.HexColor("#475569"))
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm, title=f"SEO content changes: {_safe(d['business'])}")
    p = lambda t, style="BodyText": Paragraph(escape(_safe(t)), st[style])  # noqa: E731
    c = lambda t, s=small: Paragraph(escape(_safe(t)), s)  # noqa: E731
    legend = Paragraph('In the text to use, <font backColor="#fde68a">this colour</font> is the keyword for that change and <font backColor="#e0e7ff">this colour</font> is the page\'s other keywords: keep them in.', small)
    t = d["totals"]
    flow: list[Any] = [p("SEO content changes", "Title"), p(f"{d['business']}  |  {d['website']}  |  prepared {d['date']}"),
                       p(_scope(d), "Heading4"), Spacer(1, 4), p(_intro(d)), Spacer(1, 6), p("How to work through it", "Heading3")]
    single = d.get("single")
    flow += [p(f"{i}. {s}") for i, s in enumerate(STEPS_PAGE if single else STEPS, 1)] + [Spacer(1, 3), legend]
    if d["site_notes"]:
        flow += [Spacer(1, 6), p("About this page" if single else "Notes for the whole site", "Heading3")] + [p("- " + n) for n in d["site_notes"]]
    W = [30 * mm, 152 * mm]
    HL_ROWS = {"Replace with", "Add", "Text", "Paragraph under it", "Section heading (H2)"}
    mark = {"main": [], "all": []}  # the keywords of the page being written, set for each page
    TONE = {"REPLACE": "#fef3c7", "ADD NEW": "#dcfce7", "ADD": "#dcfce7"}

    def item(n: int, element: str, action: str, rows: list[tuple[str, str]], keyword: str) -> Any:
        """One change as a small box: the header says where and what to do, then Find / Replace with (or Where / Text) lines."""
        head = Table([[c(f"[   ]  {n}.  {element}", smallb), c(action, smallb)]], colWidths=[142 * mm, 40 * mm])
        head.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(TONE.get(action, "#f1f5f9"))), ("ALIGN", (1, 0), (1, 0), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        def cell(a: str, b: str) -> Any:
            if a in HL_ROWS and b and b != NO_PARAGRAPH:
                return Paragraph(hl_pdf(b, [keyword], mark["all"]), small)
            if a == "For keyword":
                return Paragraph(hl_pdf(b, [keyword], []), small)
            return c(b)
        body = Table([[c(a, label), cell(a, b)] for a, b in rows + [("For keyword", keyword)]], colWidths=W)
        body.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        box = Table([[head], [body]], colWidths=[182 * mm])
        box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        return KeepTogether([box, Spacer(1, 5)])

    for pg in d["pages"]:
        mark["all"] = [k["keyword"] for k in pg["keywords"]]
        flow += [Spacer(1, 10), p(f"Page: {pg['path']}", "Heading2"), c(pg["url"])]
        if pg.get("scope"):
            flow.append(c(f"Page type: {pg['scope']}"))
        if pg["keywords"]:
            flow.append(c("Keywords: " + "; ".join(f"{k['keyword']}{' (primary)' if k['role'] == 'primary' else ' (secondary)' if k['role'] == 'secondary' else ''}{f' - {k['volume']:,} searches/month' if k.get('volume') else ''}" for k in pg["keywords"])))
        flow.append(Spacer(1, 4))
        if pg.get("now"):
            nw = pg["now"]
            now_mark = lambda text: Paragraph(hl_pdf(text, [k["keyword"] for k in pg["keywords"] if k["role"] == "primary"], mark["all"]), small)  # noqa: E731
            rows_now = [[c("Title", label), now_mark(nw["title"] or "(none)")], [c("Description", label), now_mark(nw["description"] or "(none)")], [c("Main heading (H1)", label), now_mark(" | ".join(nw["h1"]) or "(none)")],
                        [c("Section headings", label), now_mark(" | ".join(nw["headings"]) or "(none)")]]
            tb = Table(rows_now, colWidths=[34 * mm, 148 * mm])
            tb.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")), ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc"))]))
            flow += [p("What the page says now", "Heading4"), tb, Spacer(1, 6)]
        n = 0
        if pg["meta"]:
            flow.append(p("Meta data (goes in the page's head)", "Heading4"))
            for m in pg["meta"]:
                n += 1
                flow.append(item(n, m["element"], m["action"], [("Find", m["current"]), ("Replace with", m["new"])] if m["current"] else [("Now", "nothing"), ("Add", m["new"])], m["keyword"]))
        if pg["replace"]:
            flow.append(p("Replace existing content", "Heading4"))
            for r in pg["replace"]:
                n += 1
                flow.append(item(n, r["element"], "REPLACE", [("Find", r["current"]), ("Replace with", r["new"])], r["keyword"]))
        if pg["add"]:
            flow.append(p("Add new content", "Heading4"))
            for a in pg["add"]:
                n += 1
                rows = ([("Section heading (H2)", a["heading"])] if a.get("heading") else []) + [("Paragraph under it", a["paragraph"] or NO_PARAGRAPH)] if a["kind"] == "section" else [("Text", a["new"])]
                flow.append(item(n, a["element"], "ADD NEW", rows + [("Where", WHERE_NEW.get(a["place"], "Add it where it fits on the page."))], a["keyword"]))
        if not n:
            flow.append(p("No text changes were found for this page."))
        flow += [c("Note: " + x) for x in pg["notes"]]
    if d["missing"] or d["unmapped"]:
        flow += [Spacer(1, 12), p("Keywords that still need a page (ADD NEW)", "Heading2")]
        if d["missing"]:
            rows = [[c("Keyword", smallb), c("Make a", smallb), c("Suggested address", smallb), c("Suggested title", smallb)]] + [[c(m["keyword"]), c(m["kind"]), c(m["address"]), c(m["title"])] for m in d["missing"]]
            tb = Table(rows, colWidths=[50 * mm, 22 * mm, 48 * mm, 62 * mm], repeatRows=1)
            tb.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            flow.append(tb)
        left = [k for k in d["unmapped"] if k not in {m["keyword"] for m in d["missing"]}]
        if left:
            flow += [Spacer(1, 4), c("Chosen but not yet mapped to a page: " + ", ".join(left[:40]) + ".")]
    flow += [Spacer(1, 12), p("When it is done", "Heading3"), p("[   ] Every change above is on the live page"), p("[   ] Indexing requested in Search Console for each changed page"), p("[   ] The owner has been told, so the software can re-check the pages")]
    doc.build(flow)
    return buf.getvalue()


def filename(b: Business, ext: str, page: str | None = None) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (b.name or "site").lower()).strip("-") or "site"
    pg = re.sub(r"[^a-z0-9]+", "-", ((urlsplit(page).path if page else "") or "home").lower()).strip("-") or "home" if page else ""
    return f"seo-changes-{slug}{'-page-' + pg if page else ''}-{date.today().isoformat()}.{ext}"
