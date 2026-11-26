"""Page titles, descriptions, headings and canonical addresses for a site whose pages all send the same ones (a single-page app), written from what is known: the page's address, the main
keyword the keyword mapping gives it, and the business profile. The result is a file and a small piece of code to put on the site: the software cannot change the site's own code.

Titles are 30 to 60 characters and descriptions 70 to 160 (what Google shows in full). Nothing is invented: a page the software knows nothing about gets a plain title from its address.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..models import Business
from . import growth_content as gc
from . import keyword_mapping as km

TITLE_MAX, DESC_MIN, DESC_MAX = 60, 70, 160


def _words(path: str) -> str:
    return re.sub(r"[-_/]+", " ", path).strip().title() or "Home"


def _fit(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    cut = text[:limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:-|")
    return cut


def _brand(b: Business) -> str:
    return (b.name or "").strip()


def _where(b: Business) -> str:
    return (b.city or b.area or "").strip()


def deterministic(b: Business, page: dict[str, Any], current: dict[str, Any]) -> dict[str, str]:
    """A plain, true proposal: the page's main keyword or the name taken from its address, the business and its place."""
    path = page["path"]
    brand, where = _brand(b), _where(b)
    label = (page.get("primary") or ("" if path == "/" else _words(path.split("/")[-1]))).strip()
    label = label[:1].upper() + label[1:] if label else ""
    kind = (b.primary_category or "").strip()
    if path == "/":
        head = f"{kind or label or brand}{f' in {where}' if where else ''}".strip()
        title = f"{head} | {brand}" if brand and brand.lower() not in head.lower() else head
        h1 = head or brand
    else:
        head = f"{label}{f' in {where}' if where and where.lower() not in label.lower() else ''}"
        title = f"{head} | {brand}" if brand else head
        h1 = label
    base = (current.get("description") or "").strip()
    about = f"{label or brand}{f' at {brand}' if brand and label else ''}{f', {where}' if where else ''}."
    desc = f"{about} {base}" if base and path == "/" else f"{about} {kind + '. ' if kind else ''}Call or visit to know more.".strip()
    return {"title": _fit(title, TITLE_MAX), "description": _fit(desc, DESC_MAX), "h1": _fit(h1, 80)}


def _ai(b: Business, rows: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    from . import ai
    if not ai.is_configured():
        return {}
    facts = {"business": b.name, "category": b.primary_category, "place": ", ".join(x for x in [b.area, b.city] if x), "summary": ((b.business_brief or {}).get("overview") or b.description or "")[:400],
             "offers": ((b.business_brief or {}).get("offerings") or [s.get("name") for s in (b.services or []) if s.get("name")])[:8]}
    system = ("You write the title tag, meta description and main heading of each page of a small business website for search. Use ONLY the facts given: never invent prices, claims, awards or services. "
              f"Title: 30 to {TITLE_MAX} characters, the page's main keyword first, brand last after a pipe. Description: {DESC_MIN} to {DESC_MAX} characters, what the visitor gets and one reason to click. "
              "Heading: under 70 characters, names what the page is about. Every page must differ. Reply with JSON only.")
    user = (f"The business:\n{json.dumps(facts, ensure_ascii=False)}\n\nThe pages:\n{json.dumps([{'i': i, 'path': r['path'], 'main_keyword': r['primary'], 'other_keywords': r['secondary'][:3]} for i, r in enumerate(rows)], ensure_ascii=False)}\n\n"
            'Answer exactly: {"pages": [{"i": 0, "title": "", "description": "", "h1": ""}]}')
    try:
        data = ai.complete_json(system, user, temperature=0.2, max_tokens=min(4000, 260 * len(rows) + 300))
    except Exception:  # noqa: BLE001 - the plain proposal is used
        return {}
    out = {}
    for x in data.get("pages") or []:
        try:
            out[int(x["i"])] = {k: " ".join(str(x.get(k) or "").split()) for k in ("title", "description", "h1")}
        except (KeyError, ValueError, TypeError):
            continue
    return out


def build(db: Session, b: Business) -> dict[str, Any]:
    plan = km.plan(db, b)
    if not plan["crawled"]:
        return {"crawled": False, "pages": []}
    crawl = {urlsplit(p["url"]).path.rstrip("/") or "/": p for p in (gc._crawl(db, b).get("pages") or []) if p.get("url")}
    base = [p for p in plan["pages"]]
    from ..db import release_connection  # noqa: PLC0415
    release_connection(db)  # the plan and the crawl are read: no connection is held while the AI writes the titles and descriptions
    written = _ai(b, base)
    rows = []
    for i, pg in enumerate(base):
        cur = crawl.get(pg["path"], {})
        current = {"title": cur.get("title") or "", "description": cur.get("meta_description") or "", "h1": (cur.get("h1") if isinstance(cur.get("h1"), str) else " ".join(cur.get("h1") or [])) or "",
                   "canonical": cur.get("canonical") or ""}
        prop = deterministic(b, pg, current)
        ai_ = written.get(i) or {}
        for k, lo, hi in (("title", 30, TITLE_MAX), ("description", DESC_MIN, DESC_MAX), ("h1", 5, 80)):
            v = ai_.get(k) or ""
            if lo <= len(v) <= hi:
                prop[k] = v  # the AI's wording only when it fits
        prop["canonical"] = pg["url"]
        problems = []
        if current["canonical"] and current["canonical"].rstrip("/") != pg["url"].rstrip("/"):
            problems.append("its canonical points to another page")
        rows.append({"path": pg["path"], "url": pg["url"], "primary": pg["primary"], "current": current, "proposed": prop, "problems": problems, "by_ai": bool(ai_)})
    seen: set[str] = set()
    for r in rows:  # no two pages share a title or description
        for k in ("title", "description"):
            v = r["proposed"][k]
            if v in seen:
                r["proposed"][k] = _fit(f"{_words(r['path'].split('/')[-1])}: {v}", TITLE_MAX if k == "title" else DESC_MAX)
            seen.add(r["proposed"][k])
    return {"crawled": True, "pages": rows, "notes": plan.get("notes", [])}


def files(pages: list[dict[str, Any]]) -> dict[str, str]:
    """The metadata as a JSON file the site reads, and a React component that applies it to each route."""
    meta = {p["path"]: {"title": p["title"], "description": p["description"], "h1": p["h1"], "canonical": p["canonical"]} for p in pages}
    snippet = '''// 1. npm install react-helmet-async     (wrap the app once: <HelmetProvider><App /></HelmetProvider>)
// 2. Save the downloaded file as src/seo-meta.json
// 3. Put <PageSeo /> once inside your router layout; it sets the title, description and canonical of every route.
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import meta from './seo-meta.json';

export default function PageSeo() {
  const { pathname } = useLocation();
  const m = meta[pathname.replace(/\\/$/, '') || '/'];
  if (!m) return null;
  return (
    <Helmet>
      <title>{m.title}</title>
      <meta name="description" content={m.description} />
      <link rel="canonical" href={m.canonical} />
      <meta property="og:title" content={m.title} />
      <meta property="og:description" content={m.description} />
      <meta property="og:url" content={m.canonical} />
    </Helmet>
  );
}
// The heading in seo-meta.json ("h1") is the one <h1> each page should have: use meta[path].h1 in that page's component.
// Crawlers other than Google (AI assistants, social previews) read the HTML before JavaScript runs: pre-render the routes
// (for example vite-plugin-prerender or react-snap) so each page's HTML already carries its own title and description.
'''
    return {"json": json.dumps(meta, indent=2, ensure_ascii=False) + "\n", "react": snippet}
