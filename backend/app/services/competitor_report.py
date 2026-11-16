"""The upgrade report of one comparison: what to improve on your own site, in order, read straight from the compared numbers.

Nothing is invented. Every item points at a real difference found in this comparison (a score, a vital, a failed check, a page, a keyword)
with your value, theirs, why it matters, how to fix it, and where in the software to do it. Where you already lead, it says so.
"""
from __future__ import annotations

from typing import Any

PRI = {"high": 0, "medium": 1, "low": 2}

SCORE_FIX = {
    "performance": ("Make the site load faster", "Speed decides whether visitors stay and is a ranking signal.", "Compress and resize images, remove unused scripts, turn on caching and a CDN, load below-the-fold images lazily.", "/website-audit"),
    "seo": ("Raise the SEO score", "The basics search engines check first are weaker than theirs.", "Fix the failed technical checks listed below: titles, descriptions, headings, indexing, links.", "/fix-plan?area=seo"),
    "accessibility": ("Make the site easier to use for everyone", "Accessibility problems lose visitors and often overlap with SEO problems.", "Add alt text to images, check text contrast, label form fields, keep headings in order.", "/website-audit"),
    "best_practices": ("Follow web best practices", "Mixed content, old libraries and console errors lower trust and speed.", "Serve everything over HTTPS, update libraries, fix the errors the audit lists.", "/website-audit"),
}
VITAL_FIX = {
    "lcp": ("The main content appears later than theirs", "Visitors see the page's main image or heading after theirs.", "Compress the biggest image or hero banner, preload it, and speed up the server response."),
    "fcp": ("The first paint is slower than theirs", "Visitors stare at a blank page for longer.", "Cut render-blocking CSS and scripts, and inline the CSS the top of the page needs."),
    "cls": ("The page jumps around while loading", "Layout shifts make people click the wrong thing.", "Give every image, ad and embed a fixed width and height."),
    "tbt": ("The page is busy and slow to respond", "Heavy scripts make taps and clicks feel stuck.", "Remove or delay third-party scripts and split large JavaScript files."),
    "si": ("The page fills in more slowly than theirs", "It feels slower even if it finishes at the same time.", "Load the top of the page first and delay everything below it."),
}
CHECK_FIX = "Open the failed check in the audit, make the change it describes, then run the audit again."


def _item(area: str, priority: str, title: str, you: Any, them: Any, why: str, fix: str, to: str | None = None, label: str | None = None) -> dict[str, Any]:
    return {"area": area, "priority": priority, "title": title, "you": you, "them": them, "why": why, "fix": fix, "to": to, "to_label": label}


def build(c: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    leads: list[str] = []
    measures = wins = 0

    for m in (c.get("overall") or {}).get("scores") or []:
        if not m.get("available"):
            continue
        measures += 1
        if m["better"] == "ours":
            wins += 1
            leads.append(f"{m['label']}: {m['ours']} vs {m['competitor']}")
        elif m["better"] == "competitor":
            gap = m["competitor"] - m["ours"]
            t, why, fix, to = SCORE_FIX.get(m["key"], (f"Raise the {m['label'].lower()}", "They score higher.", "Open the audit and fix what it lists.", "/website-audit"))
            items.append(_item("Scores", "high" if gap >= 20 else "medium" if gap >= 8 else "low", t, f"{m['ours']}", f"{m['competitor']}", why, fix, to, "Open"))

    for m in (c.get("overall") or {}).get("core_web_vitals") or []:
        if not m.get("available"):
            continue
        measures += 1
        if m["better"] == "ours":
            wins += 1
            leads.append(f"{m['label']}: {m.get('ours_display')} vs {m.get('competitor_display')}")
        elif m["better"] == "competitor":
            t, why, fix = VITAL_FIX.get(m["key"], (f"{m['label']} is worse than theirs", "They are faster.", "Open the audit and follow its speed advice."))
            ratio = (m["ours"] / m["competitor"]) if m.get("competitor") else 2
            items.append(_item("Speed", "high" if ratio >= 1.6 else "medium" if ratio >= 1.2 else "low", t, m.get("ours_display"), m.get("competitor_display"), why, fix, "/website-audit", "Open"))

    for ch in (c.get("technical_seo") or {}).get("checks") or []:
        s = ch.get("status")
        if s == "ours_fail_competitor_pass":
            measures += 1
            items.append(_item("Technical SEO", "high", ch.get("title") or ch["id"], (ch.get("ours") or {}).get("display_value") or "fails", "passes", ch.get("description") or "They pass this check and you do not.", CHECK_FIX, "/fix-plan?area=seo", "Open the Fix Plan"))
        elif s == "both_fail":
            items.append(_item("Technical SEO", "medium", f"{ch.get('title') or ch['id']}: neither site passes", "fails", "fails", "Fixing it puts you ahead of them.", CHECK_FIX, "/fix-plan?area=seo", "Open the Fix Plan"))
        elif s in ("both_pass", "ours_pass_competitor_fail"):
            measures += 1
            if s == "ours_pass_competitor_fail":
                wins += 1
                leads.append(f"{ch.get('title') or ch['id']}: you pass, they fail")

    pg = c.get("pages") or {}
    thin = no_meta = no_h1 = no_schema = 0
    thin_pages: list[str] = []
    for m in pg.get("matched") or []:
        o, t = m.get("ours") or {}, m.get("competitor") or {}
        ow, tw = o.get("word_count") or 0, t.get("word_count") or 0
        if tw >= 300 and ow < tw * 0.7:
            thin += 1
            thin_pages.append(f"{m['path']} ({ow} vs {tw} words)")
        if not (o.get("meta_description") or "").strip() and (t.get("meta_description") or "").strip():
            no_meta += 1
        if not o.get("h1_count") and t.get("h1_count"):
            no_h1 += 1
        if set(t.get("schema_types") or []) - set(o.get("schema_types") or []):
            no_schema += 1
    if thin:
        items.append(_item("Content", "high" if thin >= 3 else "medium", f"{thin} of your pages {'has' if thin == 1 else 'have'} much less content than theirs", "less text", "more text", "Pages with more helpful content usually rank above thin pages for the same search.", "Add the answers visitors need: services, prices, steps, FAQs, local details. Pages: " + "; ".join(thin_pages[:5]) + ".", "/ai-content-generation/blog", "Write content"))
    if no_meta:
        items.append(_item("Content", "medium", f"{no_meta} page{'' if no_meta == 1 else 's'} with no meta description where theirs has one", "missing", "written", "The description is the text people read under the result in Google.", "Write a 140 to 160 character description for each of these pages.", "/website-audit", "Open the audit"))
    if no_h1:
        items.append(_item("Content", "medium", f"{no_h1} page{'' if no_h1 == 1 else 's'} with no main heading (H1) where theirs has one", "missing", "present", "The main heading tells search engines and visitors what the page is about.", "Add one H1 that names the service and the place.", "/website-audit", "Open the audit"))
    if no_schema:
        items.append(_item("Content", "medium", f"{no_schema} page{'' if no_schema == 1 else 's'} lacking structured data that theirs has", "missing", "present", "Structured data helps Google and AI answers show your business correctly.", "Add LocalBusiness, FAQ or Service data to these pages.", "/website-audit?tab=xray", "Open Page X-Ray"))
    only_them = pg.get("unmatched_competitor") or []
    if only_them:
        names = [(x.get("title") or x.get("url") or "") for x in only_them[:6]]
        items.append(_item("Content", "medium", f"They have {len(only_them)} page{'' if len(only_them) == 1 else 's'} you have no match for", "none", f"{len(only_them)} pages", "Each page can rank for searches your site does not answer yet.", "Consider a page for each topic: " + "; ".join(n for n in names if n) + ".", "/ai-content-generation/blog", "Write content"))

    kw = ((c.get("keywords_and_content_gaps") or {}).get("researched") or {})
    gaps = [i for i in kw.get("items") or [] if i["side"] == "competitor"]
    for i in gaps[:8]:
        vol = f"{i['volume']:,} searches a month" if i.get("volume") else "search volume not verified"
        items.append(_item("Keywords", "high" if (i.get("volume") or 0) >= 500 else "medium", f"Target “{i['keyword']}”", "not on your pages", f"used on {i['pages']} of their pages", f"They aim at it ({vol}); your site does not.",
                           "Add it to My Keywords, then write a page or blog for it and use it in the title and main heading.", f"/ai-content-generation/blog?topic={i['keyword']}", "Write a blog"))
    for i in [x for x in kw.get("items") or [] if x["side"] == "client"][:3]:
        leads.append(f"“{i['keyword']}”: only your site targets it" + (f" ({i['volume']:,}/mo)" if i.get("volume") else ""))

    items.sort(key=lambda x: (PRI[x["priority"]], x["area"]))
    counts = {p: sum(1 for i in items if i["priority"] == p) for p in PRI}
    name = (c.get("competitor") or {}).get("name") or (c.get("competitor") or {}).get("target") or "the competitor"
    if not items and not measures:
        headline = "There is not enough audit data on both sides yet to say where to upgrade. Run the audit on your site and on the competitor, then compare again."
    elif not items:
        headline = f"You match or beat {name} on every measure compared. Keep your pages fresh and keep tracking them."
    else:
        headline = f"{name} is ahead on {len(items)} point{'s' if len(items) != 1 else ''}, {counts['high']} of them important. You lead on {wins} of {measures} measures compared."
    return {"headline": headline, "counts": counts, "total": len(items), "wins": wins, "measures": measures, "items": items, "strengths": leads[:12],
            "areas": sorted({i["area"] for i in items}), "note": "Built from this comparison only: your latest audit and crawl against theirs. Run both audits again after your changes to see the gaps close."}
