"""Where each picked keyword is used on the site, and where to add it.

Two views, both from the real site:
  by_keyword(): for every tracked keyword, the pages that already use it and in which place (address, title, heading, description), the page it is meant for (the keyword mapping) and the
                other pages that fit it. Cheap: it reads the last site crawl.
  page_detail(): one page read live (title, description, headings, first paragraph, text, image descriptions), which tracked keywords it already uses and in which place, which it should
                carry, and exactly where to add each missing one, with a line to paste. The page's scope decides what belongs on it: an offer page takes buying keywords, a guide takes questions,
                a policy or contact page takes none.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, Keyword
from . import growth_content as gc
from . import keyword_mapping as km
from . import page_meta
from .gsc import host_of

PLACES = ["address", "title", "heading", "description"]
INFO = ("about", "contact", "how-it-works", "how_it_works", "faq", "gallery", "team", "reviews", "location", "visit")
POLICY = ("privacy", "terms", "policy", "policies", "refund", "return", "cookie", "disclaimer", "sitemap")


class PlacementError(ValueError):
    pass


def scope_of(path: str, title: str = "") -> dict[str, str]:
    """What kind of page this is, which decides which keywords belong on it."""
    p = path.lower().strip("/")
    if not p:
        return {"kind": "home", "label": "Home page", "takes": "Your main keywords: what you are, what you offer and where."}
    if any(w in p for w in POLICY):
        return {"kind": "policy", "label": "Policy page", "takes": "No keywords: it is a legal page. Keep it plain."}
    if any(w in p for w in ("blog", "news", "guide", "article", "post")):
        return {"kind": "blog", "label": "Blog or guide", "takes": "Questions, guides and comparisons (informational keywords)."}
    if any(w in p for w in INFO):
        return {"kind": "info", "label": "Information page", "takes": "Only your brand and place: it supports the other pages, it does not compete for buying keywords."}
    return {"kind": "offer", "label": "Product or service page", "takes": "The buying keywords for exactly what this page offers."}


def _flags(page: dict[str, Any], keyword: str) -> dict[str, bool]:
    path = urlsplit(page.get("url") or "").path
    generic = bool(page.get("_generic"))
    h1 = page.get("h1") if isinstance(page.get("h1"), str) else " ".join(page.get("h1") or [])
    return {"address": gc.has_keyword(gc._corpus([re.sub(r"[-_/]+", " ", path)]), keyword),
            "title": (not generic) and gc.has_keyword(gc._corpus([page.get("title")]), keyword),
            "heading": gc.has_keyword(gc._corpus([h1]), keyword),
            "description": (not generic) and gc.has_keyword(gc._corpus([page.get("meta_description")]), keyword)}


def _pages(db: Session, b: Business) -> list[dict[str, Any]]:
    from collections import Counter
    crawl = gc._crawl(db, b)
    pages = [dict(p) for p in (crawl.get("pages") or []) if p.get("status") == 200 and p.get("url")]
    same = Counter(((p.get("title") or "").strip(), (p.get("meta_description") or "").strip()) for p in pages)
    shared = {k for k, n in same.items() if n >= 3 and k != ("", "")}
    for p in pages:  # a title and description every page repeats say nothing about this page
        p["_generic"] = ((p.get("title") or "").strip(), (p.get("meta_description") or "").strip()) in shared and (urlsplit(p["url"]).path or "/").rstrip("/") != ""
    return pages


PURPOSES = [("website", "Page"), ("aeo", "FAQ"), ("meta", "Meta data"), ("blog", "Blog"), ("gmb_post", "Google post"), ("gbp_profile", "Google profile"), ("geo", "AI questions")]


def purposes_for(b: Business, k: Keyword, used: dict[str, Any], planned: list[str], meant: dict[str, Any] | None, blog: bool) -> list[dict[str, Any]]:
    """For one keyword, each purpose it can serve: whether it is used there already, whether it is planned, and the exact thing to add, with where to go."""
    from . import keyword_ai
    kw = k.keyword
    label = kw[:1].upper() + kw[1:]
    brand, where = (b.name or "").strip(), (b.city or b.area or "").strip()
    place = f" in {where}" if where and where.lower() not in kw.lower() else ""
    page = meant["path"] if meant else None
    q = keyword_ai.geo_question(kw)
    at_brand = " at " + brand if brand else ""
    meta_title = page_meta._fit(label + place + (" | " + brand if brand else ""), 60)
    meta_desc = page_meta._fit(label + place + at_brand + ". Call or visit to know more.", 160)
    blog_title = label if blog else label + place + ": what to know before you choose"
    out = {
        "website": {"headline": f"Use it on {page}" if page else "It needs a page",
                    "text": (f"Put it in the title, the main heading and the first paragraph of {page}." if page else f"No page carries it yet. Create one at /{_slug_of(kw)} and name it in the title, heading and first paragraph."),
                    "to": {"kind": "page", "url": meant["url"]} if meant else {"kind": "write", "href": f"/ai-content-generation/blog?keyword={kw}"}, "cta": "Where to add" if meant else "Create it"},
        "aeo": {"headline": "Answer it as a question on the page", "text": f"Question: {q}\nAnswer in two or three plain sentences with \"{kw}\" in the first one, then mark it up as FAQ schema.", "to": {"kind": "link", "href": "/website-audit?tab=schema"}, "cta": "Add the answer"},
        "meta": {"headline": "Put it in the page's title and description", "text": "Title: " + meta_title + "\nDescription: " + meta_desc,
                 "to": {"kind": "page", "url": meant["url"]} if meant else {"kind": "none"}, "cta": "Open the page" if meant else ""},
        "blog": {"headline": "Write a blog post on it", "text": "Title: " + blog_title + "\nWrite for people first; use the keyword in the title, the first paragraph and one heading.", "to": {"kind": "link", "href": f"/ai-content-generation/blog?keyword={kw}"}, "cta": "Write the post"},
        "gmb_post": {"headline": "Post about it on Google", "text": f"Post topic: {label}{place}. Say what you offer, show a photo, and end with a call to action (Call now or Book).", "to": {"kind": "link", "href": f"/google-posts?topic={kw}"}, "cta": "Write the post"},
        "gbp_profile": {"headline": "Mention it in your Google profile", "text": f"Use \"{kw}\" once in the business description, and add it as a service if you really offer it. Never put it in the business name.", "to": {"kind": "link", "href": "/gmb-profile/profile?sub=edit&step=about"}, "cta": "Edit the profile"},
        "geo": {"headline": "Track it as a question AI assistants are asked", "text": f"Question: {q}", "to": {"kind": "geo"}, "cta": "Ask the AI engines"},
    }
    return [{"key": key, "label": lab, "used": bool(used.get(key)), "planned": key in planned, **out[key]} for key, lab in PURPOSES]


def _slug_of(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")[:60]


def by_keyword(db: Session, b: Business, ids: list[int] | None = None) -> dict[str, Any]:
    from . import keyword_ai
    usage_items = {i["id"]: i for i in keyword_ai.usage(db, b)["items"]}
    pages = _pages(db, b)
    plan = km.plan(db, b)
    assigned: dict[str, tuple[str, str]] = {}
    for pg in plan["pages"]:
        if pg["primary"]:
            assigned[pg["primary"]] = (pg["url"], "main")
        for s in pg["secondary"]:
            assigned[s] = (pg["url"], "supporting")
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    kws.sort(key=lambda k: (-(k.volume or 0), k.keyword))
    if ids:  # only the keywords asked for (the ones selected on My Keywords)
        kws = [k for k in kws if k.id in set(ids)]
    items = []
    for k in kws:
        used, fits = [], []
        for p in pages:
            path = (urlsplit(p["url"]).path or "/").rstrip("/") or "/"
            fl = _flags(p, k.keyword)
            where = [pl for pl in PLACES if fl[pl]]
            if where:
                used.append({"url": p["url"], "path": path, "places": where})
            sc = scope_of(path)
            if sc["kind"] in ("policy", "info"):
                continue
            score = sum(km.WEIGHT[x] * km._cover(c, k.keyword) for x, c in (("title", gc._corpus([p.get("title")]) if not p["_generic"] else set()), ("heading", gc._corpus([km._h1(p)])),
                                                                              ("slug", gc._corpus([re.sub(r"[-_/]+", " ", path)])), ("phrases", gc._corpus([x.get("keyword") for x in (p.get("top_keywords") or []) if isinstance(x, dict)]))))
            if score > 0:
                fits.append({"url": p["url"], "path": path, "score": round(score, 1)})
        fits.sort(key=lambda f: -f["score"])
        target = assigned.get(k.keyword)
        strong = [u for u in used if "title" in u["places"] or "heading" in u["places"] or "address" in u["places"]]
        status = "used" if strong else "weak" if used else "unused"
        blog = km.is_blog(k.keyword, k.intent)
        meant = {"url": target[0], "path": (urlsplit(target[0]).path or "/").rstrip("/") or "/", "role": target[1]} if target else None
        if meant:
            meant["scope"] = scope_of(meant["path"])["kind"]
        ui = usage_items.get(k.id) or {"used": {}, "planned": []}
        # the page and the meta data are judged page by page (the same check as the status), not by words pooled from the whole site
        ui = {"planned": ui["planned"], "used": {**ui["used"], "website": bool(strong), "meta": any("title" in u["places"] or "description" in u["places"] for u in used)}}
        items.append({"id": k.id, "keyword": k.keyword, "volume": k.volume, "rank": k.rank, "kind": "post" if blog else "page", "status": status, "used_on": used[:8],
                      "meant_for": meant, "other_fits": [f for f in fits if not target or f["url"] != target[0]][:3],
                      "purposes": purposes_for(b, k, ui["used"], ui["planned"], meant or ({"url": fits[0]["url"], "path": fits[0]["path"], "role": "main"} if fits else None), blog)})
    counts = {s: sum(1 for i in items if i["status"] == s) for s in ("used", "weak", "unused")}
    return {"crawled": bool(pages), "keywords": items, "counts": counts, "pages": [{"url": p["url"], "path": (urlsplit(p["url"]).path or "/").rstrip("/") or "/"} for p in pages]}


# ------------------------------------------------------------------ one page, read live
def _read(url: str) -> dict[str, Any]:
    from bs4 import BeautifulSoup

    from .net import site_client
    client = site_client(15)
    try:
        r = client.get(url)
    except Exception as exc:  # noqa: BLE001
        raise PlacementError(f"The page could not be loaded: {str(exc)[:100]}") from exc
    finally:
        client.close()
    if r.status_code >= 400:
        raise PlacementError(f"The page answers HTTP {r.status_code}.")
    soup = BeautifulSoup(r.text, "html.parser")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    d = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    heads = [(h.name, h.get_text(" ", strip=True)) for h in soup.find_all(["h1", "h2", "h3"]) if h.get_text(strip=True)]
    alts = [(i.get("alt") or "").strip() for i in soup.find_all("img")]
    for t in soup(["script", "style", "noscript", "nav", "footer", "header", "form"]):
        t.decompose()
    all_paras = [p.get_text(" ", strip=True) for p in soup.find_all("p") if p.get_text(" ", strip=True)]
    paras = [p for p in all_paras if len(p.split()) >= 8]
    text = " ".join(soup.get_text(" ", strip=True).split())
    return {"status": r.status_code, "title": title, "description": (d.get("content") or "").strip() if d else "", "h1": [t for n, t in heads if n == "h1"], "headings": [t for n, t in heads if n != "h1"],
            "intro": paras[0] if paras else "", "paragraphs": all_paras[:12], "text": text, "words": len(text.split()), "alts": alts, "images": len(alts)}


def _used(read: dict[str, Any], path: str, keyword: str) -> dict[str, Any]:
    has = lambda text: gc.has_keyword(gc._corpus([text]), keyword)  # noqa: E731
    first100 = " ".join(read["text"].split()[:100])
    phrase = " ".join(gc.core(keyword))
    low = " ".join(gc._words(read["text"]))
    return {"address": has(re.sub(r"[-_/]+", " ", path)), "title": has(read["title"]), "heading": any(has(h) for h in read["h1"]), "subheading": any(has(h) for h in read["headings"]),
            "description": has(read["description"]), "intro": has(read["intro"] or first100), "image": any(has(a) for a in read["alts"]), "mentions": low.count(phrase) if phrase else 0}


def _relevance(read: dict[str, Any], path: str, keyword: str) -> float:
    core = gc.core(keyword)
    if not core:
        return 0.0
    corpus = gc._corpus([read["title"], read["description"], " ".join(read["h1"]), " ".join(read["headings"]), read["text"][:6000], re.sub(r"[-_/]+", " ", path)])
    return sum(1 for w in core if w in corpus) / len(core)


def _head_fit(read: dict[str, Any], path: str, keyword: str) -> float:
    """How much of the keyword the page's title, headings and address already say: this, not words scattered in the text, shows the page is about it."""
    core = gc.core(keyword)
    if not core:
        return 0.0
    corpus = gc._corpus([read["title"], " ".join(read["h1"]), " ".join(read["headings"]), re.sub(r"[-_/]+", " ", path)])
    return sum(1 for w in core if w in corpus) / len(core)


def _place_rules(role: str, kind: str, u: dict[str, Any]) -> list[tuple[str, str]]:
    """(place, why) still to fill for a keyword on a page, by the keyword's role and the page's scope. A supporting keyword never goes in the title."""
    out: list[tuple[str, str]] = []
    if role == "main":
        if not u["title"]:
            out.append(("title", "The title is the strongest place: it is what Google shows and ranks on."))
        if not u["heading"]:
            out.append(("heading", "The page's main heading should name the main keyword."))
        if not u["description"]:
            out.append(("description", "The description is what searchers read before they click."))
        if not u["intro"]:
            out.append(("intro", "Say it in the first paragraph, in plain words."))
    else:
        if not u["subheading"] and not u["heading"]:
            out.append(("subheading", "A section heading on this keyword shows the page covers it."))
        if not u["intro"] and not u["mentions"]:
            out.append(("text", "Write a short paragraph that answers this search."))
    if kind == "offer" and role == "main" and not u["image"]:
        out.append(("image", "Describe a product photo with it in its alt text."))
    return out


def _examples(b: Business, path: str, read: dict[str, Any], todo: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    """Lines to paste, written from the business facts and what the page already says. The AI when it is set up, plain templates otherwise."""
    brand, where = (b.name or "").strip(), (b.city or b.area or "").strip()
    out: dict[tuple[str, str], str] = {}
    for t in todo:
        kw = t["keyword"]
        label = kw[:1].upper() + kw[1:]
        place = t["place"]
        if place == "title":
            out[(kw, place)] = page_meta._fit(f"{label} | {brand}" if brand else label, 60)
        elif place == "heading":
            out[(kw, place)] = page_meta._fit(f"{label}{f' in {where}' if where and where.lower() not in kw.lower() else ''}", 70)
        elif place == "description":
            out[(kw, place)] = page_meta._fit(f"{label}{f' at {brand}' if brand else ''}{f', {where}' if where and where.lower() not in kw.lower() else ''}. {(b.primary_category or '').strip()} Call or visit to know more.".replace("  ", " "), 160)
        elif place == "intro":
            out[(kw, place)] = f"{brand or 'We'} offer{'s' if brand else ''} {kw}{f' in {where}' if where and where.lower() not in kw.lower() else ''}."
        elif place == "subheading":
            out[(kw, place)] = label
        elif place == "image":
            out[(kw, place)] = f"{label}{f' at {brand}' if brand else ''}"
        else:
            out[(kw, place)] = f"A short paragraph on {kw}: what it includes, who it is for, and how to book."
    from . import ai
    if not ai.is_configured() or not todo:
        return out
    facts = {"business": brand, "category": b.primary_category, "place": where, "summary": ((b.business_brief or {}).get("overview") or b.description or "")[:300],
             "page": path, "page_title": read["title"], "page_heading": read["h1"][:1]}
    system = ("You write short pieces of website text that place a keyword naturally. Use ONLY the facts given: never invent prices, claims, years, awards or services. Title under 60 characters, "
              "description 70 to 160, heading under 70, intro one plain sentence, subheading under 60, text one short paragraph of two sentences, image a short alt text. Reply with JSON only.")
    user = (f"Facts:\n{json.dumps(facts, ensure_ascii=False)}\n\nWrite for each:\n{json.dumps([{'i': i, 'keyword': t['keyword'], 'place': t['place']} for i, t in enumerate(todo)], ensure_ascii=False)}\n\n"
            'Answer exactly: {"lines": [{"i": 0, "text": ""}]}')
    try:
        data = ai.complete_json(system, user, temperature=0.2, max_tokens=min(4000, 150 * len(todo) + 300))
    except Exception:  # noqa: BLE001 - the templates stand
        return out
    limits = {"title": 60, "description": 160, "heading": 80, "subheading": 70, "intro": 240, "text": 420, "image": 120}
    for x in data.get("lines") or []:
        try:
            t = todo[int(x["i"])]
        except (KeyError, ValueError, TypeError, IndexError):
            continue
        s = " ".join(str(x.get("text") or "").split())
        if s and len(s) <= limits.get(t["place"], 200) and (t["place"] != "description" or len(s) >= 70):
            out[(t["keyword"], t["place"])] = s
    return out


def page_detail(db: Session, b: Business, url: str, focus: str | None = None) -> dict[str, Any]:
    host = host_of(b.website)
    full = url if url.startswith("http") else f"https://{host}{url if url.startswith('/') else '/' + url}"
    if not host or host_of(full) != host:
        raise PlacementError("Only pages of this project's own website can be opened here.")
    path = (urlsplit(full).path or "/").rstrip("/") or "/"
    read = _read(full)
    scope = scope_of(path, read["title"])
    plan = km.plan(db, b)
    mine = next((p for p in plan["pages"] if p["path"] == path), None)
    role_of = {}
    if mine:
        if mine["primary"]:
            role_of[mine["primary"]] = "main"
        for s in mine["secondary"]:
            role_of[s] = "supporting"
    kws = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    kws.sort(key=lambda k: (-(k.volume or 0), k.keyword))
    rows, todo = [], []
    for k in kws:
        rel = _relevance(read, path, k.keyword)
        role = role_of.get(k.keyword) or ("main" if focus and focus.lower() == k.keyword.lower() else None)
        blog = km.is_blog(k.keyword, k.intent)
        belongs = scope["kind"] not in ("policy", "info") and ((scope["kind"] == "blog") == blog or scope["kind"] == "home")
        if not role and not (_head_fit(read, path, k.keyword) >= 0.6 and belongs) and not (focus and focus.lower() == k.keyword.lower()):
            continue
        role = role or ("supporting" if rel >= 0.5 else "main")
        u = _used(read, path, k.keyword)
        need = _place_rules(role, scope["kind"], u)
        current_of = {"title": read["title"], "heading": " | ".join(read["h1"]), "description": read["description"], "intro": read["intro"], "image": next((a for a in read["alts"] if a), "")}
        warning = None
        if scope["kind"] in ("info", "policy") and role == "main":
            warning = f"This keyword is mapped to {'an' if scope['label'][0].lower() in 'aeiou' else 'a'} {scope['label'].lower()}, which should not compete for it. Map it to a page that offers it (Change the page on My Keywords), or leave this page as it is."
        rows.append({"id": k.id, "keyword": k.keyword, "volume": k.volume, "rank": k.rank, "role": role, "fit": round(rel * 100), "used": u, "belongs": belongs or bool(role_of.get(k.keyword)),
                     "focus": bool(focus and focus.lower() == k.keyword.lower()), "words": gc.core(k.keyword), "warning": warning,
                     "to_add": [{"place": pl, "why": why, "current": current_of.get(pl) or None} for pl, why in need]})
        todo += [{"keyword": k.keyword, "place": pl} for pl, _ in need]
    rows.sort(key=lambda r: (not r["focus"], r["role"] != "main", -(r["volume"] or 0)))
    rows = rows[:14]
    wanted = [t for t in todo if any(r["keyword"] == t["keyword"] for r in rows)][:24]
    lines = _examples(b, path, read, wanted)
    for r in rows:
        for a in r["to_add"]:
            a["example"] = lines.get((r["keyword"], a["place"]), "")
    notes = []
    if read["words"] < 40:
        notes.append("This page shows almost no text without JavaScript (a single-page site), so what is read here is only its address and the HTML head. Search engines and AI assistants see the same.")
    return {"url": full, "path": path, "scope": scope, "title": read["title"], "description": read["description"], "h1": read["h1"], "headings": read["headings"][:12], "intro": read["intro"][:300],
            "words": read["words"], "images": read["images"], "images_without_alt": sum(1 for a in read["alts"] if not a), "keywords": rows, "notes": notes,
            "content": {"title": read["title"], "description": read["description"], "h1": read["h1"], "headings": read["headings"][:20], "paragraphs": [x[:420] for x in read["paragraphs"]]},
            "main_keyword": mine["primary"] if mine else None}
