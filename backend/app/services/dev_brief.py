"""The developer brief: one document a developer can work from to put the keyword changes on the website.

For every page that has keywords mapped to it: the page, its main and supporting keywords, and a table of what to REPLACE or ADD (where on the page, what is there now, what to change it to, and for which keyword).
After the pages: the keywords that still have no page, notes for the whole site, and what to check when it is done. Everything comes from the page overview (the page read live), so what the document says is
what the page says today. The text proposed is only what the software could write from the business's own facts: the developer or the owner reads it before it goes live.

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

ELEMENT = {"title": "Page title (the <title> tag)", "description": "Meta description", "heading": "Main heading (H1)", "intro": "First paragraph", "subheading": "New section heading (H2)",
           "text": "New paragraph", "image": "Image description (alt text)"}
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


def collect(db: Session, b: Business, only_page: str | None = None) -> dict[str, Any]:
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
        entry: dict[str, Any] = {"path": path, "url": urls[path], "keywords": [{"keyword": k.keyword, "role": k.role or "", "volume": k.volume} for k in by_page[path]], "changes": [], "notes": []}
        if read.get("error"):
            entry["notes"].append(read["error"])
        else:
            entry["scope"] = read["scope"]["label"]
            entry["notes"] += [n for n in read.get("notes", [])]
            for r in read["keywords"]:
                if r.get("warning"):
                    entry["notes"].append(f"\"{r['keyword']}\": {r['warning']}")
                    continue
                for a in r["to_add"]:
                    if not a.get("example"):
                        continue
                    entry["changes"].append({"element": ELEMENT.get(a["place"], a["place"]), "action": "Replace" if a.get("current") else "Add", "current": a.get("current") or "", "new": a["example"],
                                             "keyword": r["keyword"], "why": a["why"]})
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
            "totals": {"pages": len(pages), "changes": sum(len(p["changes"]) for p in pages), "keywords": len(kws)}}


STEPS = ["Make each change on the page named, in the place named (title, description, heading, paragraph, alt text).",
         "Keep one main heading (H1) per page and write for people first: use the keyword once or twice, in plain words.",
         "Publish, then open the page and check the change is there.",
         "In Search Console, use URL Inspection > Request indexing for each changed page.",
         "Tell the owner: the Website Audit in the software is run again to confirm, and the keywords are tracked for the next weeks."]


def render_md(d: dict[str, Any]) -> str:
    esc = lambda s: str(s or "").replace("|", "\\|").replace("\n", " ")  # noqa: E731
    out = [f"# SEO content changes: {d['business']}", "", f"Website: {d['website']}  ", f"Prepared: {d['date']}  ", f"Scope: {d['totals']['pages']} pages, {d['totals']['changes']} changes, {d['totals']['keywords']} chosen keywords", "",
           "This document lists what to change on each page so the chosen keywords are on the right pages. The proposed text is a draft written from the business's own facts: read each line and change it so it is true before it goes live.", "",
           "## How to work through it", ""] + [f"{i}. {s}" for i, s in enumerate(STEPS, 1)] + [""]
    if d["site_notes"]:
        out += ["## Notes for the whole site", ""] + [f"- {n}" for n in d["site_notes"]] + [""]
    for p in d["pages"]:
        out += [f"## Page: {p['path']}", "", f"Address: {p['url']}  "]
        if p.get("scope"):
            out.append(f"Page type: {p['scope']}  ")
        if p["keywords"]:
            out.append("Keywords: " + "; ".join(f"**{k['keyword']}**{' (primary)' if k['role'] == 'primary' else ' (secondary)' if k['role'] == 'secondary' else ''}{f', {k['volume']:,} searches/month' if k.get('volume') else ''}" for k in p["keywords"]))
        out.append("")
        if p["changes"]:
            out += ["| Done | # | Where | Now | Change to | Keyword |", "|---|---|---|---|---|---|"]
            out += [f"| [ ] | {i} | {esc(c['action'])}: {esc(c['element'])} | {esc(c['current']) or '(nothing there)'} | {esc(c['new'])} | {esc(c['keyword'])} |" for i, c in enumerate(p["changes"], 1)]
            out.append("")
        else:
            out += ["No text changes were found for this page.", ""]
        out += [f"Note: {n}" for n in p["notes"]] + ([""] if p["notes"] else [])
    if d["missing"] or d["unmapped"]:
        out += ["## Keywords that still need a page", ""]
        if d["missing"]:
            out += ["| Keyword | Make a | Suggested address | Suggested title |", "|---|---|---|---|"] + [f"| {esc(m['keyword'])} | {m['kind']} | {esc(m['address'])} | {esc(m['title'])} |" for m in d["missing"]]
            out.append("")
        left = [k for k in d["unmapped"] if k not in {m["keyword"] for m in d["missing"]}]
        if left:
            out += ["Chosen but not yet mapped to a page: " + ", ".join(left[:40]) + ".", ""]
    out += ["## When it is done", "", "- [ ] Every change above is on the live page", "- [ ] Indexing requested in Search Console for each changed page", "- [ ] The owner has been told, so the software can re-check the pages", ""]
    return "\n".join(out)


def _safe(s: Any) -> str:
    """Helvetica draws Latin text only: other characters become a plain stand-in rather than a broken box."""
    s = str(s or "").replace("\u2013", "-").replace("\u2014", "-").replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"').replace("\u2026", "...").replace("\u00b7", "-")
    return s.encode("latin-1", "replace").decode("latin-1")


def render_pdf(d: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    st = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=st["BodyText"], fontSize=8.2, leading=10.4)
    smallb = ParagraphStyle("smallb", parent=small, fontName="Helvetica-Bold")
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm, bottomMargin=14 * mm, title=f"SEO content changes: {_safe(d['business'])}")
    p = lambda t, style="BodyText": Paragraph(escape(_safe(t)), st[style])  # noqa: E731
    c = lambda t, s=small: Paragraph(escape(_safe(t)), s)  # noqa: E731
    flow: list[Any] = [p("SEO content changes", "Title"), p(f"{d['business']}  |  {d['website']}  |  prepared {d['date']}"),
                       p(f"{d['totals']['pages']} pages, {d['totals']['changes']} changes, {d['totals']['keywords']} chosen keywords", "Heading4"), Spacer(1, 4),
                       p("This document lists what to change on each page so the chosen keywords are on the right pages. The proposed text is a draft written from the business's own facts: read each line "
                         "and change it so it is true before it goes live."), Spacer(1, 6), p("How to work through it", "Heading3")]
    flow += [p(f"{i}. {s}") for i, s in enumerate(STEPS, 1)]
    if d["site_notes"]:
        flow += [Spacer(1, 6), p("Notes for the whole site", "Heading3")] + [p("- " + n) for n in d["site_notes"]]
    grid = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cbd5e1")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    for pg in d["pages"]:
        block: list[Any] = [Spacer(1, 10), p(f"Page: {pg['path']}", "Heading2"), c(pg["url"])]
        if pg.get("scope"):
            block.append(c(f"Page type: {pg['scope']}"))
        if pg["keywords"]:
            block.append(c("Keywords: " + "; ".join(f"{k['keyword']}{' (primary)' if k['role'] == 'primary' else ' (secondary)' if k['role'] == 'secondary' else ''}{f' - {k['volume']:,} searches/month' if k.get('volume') else ''}" for k in pg["keywords"])))
        block.append(Spacer(1, 3))
        if pg["changes"]:
            rows = [[c("#", smallb), c("Where", smallb), c("Now", smallb), c("Change to", smallb), c("Keyword", smallb), c("Done", smallb)]]
            for i, ch in enumerate(pg["changes"], 1):
                rows.append([c(i), c(f"{ch['action']}: {ch['element']}"), c(ch["current"] or "(nothing there)"), c(ch["new"]), c(ch["keyword"]), c("[   ]")])
            t = Table(rows, colWidths=[7 * mm, 31 * mm, 48 * mm, 52 * mm, 28 * mm, 12 * mm], repeatRows=1)
            t.setStyle(TableStyle(grid))
            block.append(t)
        else:
            block.append(p("No text changes were found for this page."))
        block += [c("Note: " + n) for n in pg["notes"]]
        flow += [KeepTogether(block[:4])] + block[4:]
    if d["missing"] or d["unmapped"]:
        flow += [Spacer(1, 12), p("Keywords that still need a page", "Heading2")]
        if d["missing"]:
            rows = [[c("Keyword", smallb), c("Make a", smallb), c("Suggested address", smallb), c("Suggested title", smallb)]] + [[c(m["keyword"]), c(m["kind"]), c(m["address"]), c(m["title"])] for m in d["missing"]]
            t = Table(rows, colWidths=[50 * mm, 22 * mm, 48 * mm, 58 * mm], repeatRows=1)
            t.setStyle(TableStyle(grid))
            flow.append(t)
        left = [k for k in d["unmapped"] if k not in {m["keyword"] for m in d["missing"]}]
        if left:
            flow += [Spacer(1, 4), c("Chosen but not yet mapped to a page: " + ", ".join(left[:40]) + ".")]
    flow += [Spacer(1, 12), p("When it is done", "Heading3"), p("[   ] Every change above is on the live page"), p("[   ] Indexing requested in Search Console for each changed page"), p("[   ] The owner has been told, so the software can re-check the pages")]
    doc.build(flow)
    return buf.getvalue()


def filename(b: Business, ext: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (b.name or "site").lower()).strip("-") or "site"
    return f"seo-changes-{slug}-{date.today().isoformat()}.{ext}"
