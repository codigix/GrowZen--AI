"""Turns a finding (an audit issue, a website improvement or a weekly routine) into a complete task: a description a person can act on, links to test the result,
a due date inside the week, and a priority label. Pure functions, no network."""
import re
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote, urlparse

from .fix_examples import fix_help

PRIORITY_LABEL = {1: "P1 Critical", 2: "P2 High", 3: "P3 Medium", 4: "P4 Low"}
DUE_WEEKDAY = {1: 1, 2: 2, 3: 3, 4: 4}  # priority -> weekday offset from Monday: critical on Tuesday ... low on Friday
OP_WEEKDAY = {"reviews": 1, "approve-drafts": 1, "gbp-post": 2, "tech-check": 3, "backlinks": 3, "content": 4, "rank-review": 4}
EFFORT_HOURS = {"quick": "under 1 hour", "medium": "1-3 hours", "large": "half a day or more"}


def due_for(wk: date, priority: int, operation: str | None = None, today: date | None = None) -> date:
    """A working day inside the week. In the current week a date that has already passed becomes today, so a task is never overdue the moment it is created."""
    today = today or date.today()
    due = wk + timedelta(days=OP_WEEKDAY.get(operation or "", DUE_WEEKDAY.get(priority, 3)))
    return max(due, today) if wk <= today <= wk + timedelta(days=6) else due


def _base(website: str | None) -> str:
    w = (website or "").strip()
    if not w:
        return ""
    w = w if w.startswith("http") else f"https://{w}"
    p = urlparse(w)
    return f"{p.scheme}://{p.netloc}"


def page_url(website: str | None, text: str) -> str | None:
    """The page an issue is about: its title starts with the path ("/about has no title")."""
    m = re.match(r"\s*(/[^\s:]*)", text or "")
    base = _base(website)
    return base + m.group(1) if m and base else None


def test_links(kind: str, website: str | None, urls: list[str], code: str = "", area: str = "", gbp_url: str | None = None) -> list[dict[str, str]]:
    """Where to check the fix: the page itself first, then the right testing tool for the kind of problem."""
    base = _base(website)
    host = urlparse(base).netloc
    target = urls[0] if urls else base
    out: list[dict[str, str]] = []
    if target:
        out.append({"label": "Open the page" if urls else "Open the website", "url": target})
    a = f"{area} {code} {kind}".lower()
    if not target and not gbp_url:
        return out
    if any(w in a for w in ("structured", "schema", "localbusiness", "faq")):
        out += [{"label": "Google Rich Results Test", "url": f"https://search.google.com/test/rich-results?url={quote(target, safe='')}"},
                {"label": "Schema.org validator", "url": f"https://validator.schema.org/#url={quote(target, safe='')}"}]
    if any(w in a for w in ("speed", "performance", "lcp", "cls", "mobile", "viewport", "technical", "image", "compress", "cache", "render")):
        out.append({"label": "PageSpeed Insights", "url": f"https://pagespeed.web.dev/analysis?url={quote(target, safe='')}"})
    if any(w in a for w in ("open graph", "og:", "twitter", "social", "share")):
        out += [{"label": "Facebook Sharing Debugger", "url": f"https://developers.facebook.com/tools/debug/?q={quote(target, safe='')}"},
                {"label": "LinkedIn Post Inspector", "url": f"https://www.linkedin.com/post-inspector/inspect/{quote(target, safe='')}"}]
    if any(w in a for w in ("robots", "crawl", "indexing", "noindex", "canonical", "sitemap", "javascript", "hreflang")):
        if base:
            out += [{"label": "robots.txt", "url": f"{base}/robots.txt"}, {"label": "sitemap.xml", "url": f"{base}/sitemap.xml"}]
        out.append({"label": "Is it indexed? (Google site: search)", "url": f"https://www.google.com/search?q={quote('site:' + (target.split('//', 1)[-1] if urls else host))}"})
    if any(w in a for w in ("https", "security", "ssl", "header")) and host:
        out += [{"label": "Security headers scan", "url": f"https://securityheaders.com/?q={quote(host)}&followRedirects=on"},
                {"label": "SSL Labs test", "url": f"https://www.ssllabs.com/ssltest/analyze.html?d={quote(host)}"}]
    if any(w in a for w in ("title", "meta description", "description", "heading", "h1", "on-page", "thin")) and target:
        out.append({"label": "See it as Google (cached copy search)", "url": f"https://www.google.com/search?q={quote('site:' + target.split('//', 1)[-1])}"})
    if any(w in a for w in ("gbp", "google business", "profile", "review", "photo", "post")) and gbp_url:
        out.append({"label": "Your listing on Google Maps", "url": gbp_url})
        out.append({"label": "Google Business Profile manager", "url": "https://business.google.com/locations"})
    if any(w in a for w in ("backlink", "citation", "link")) and host:
        out.append({"label": "Who links to the site (Google)", "url": f"https://www.google.com/search?q={quote('link:' + host)}"})
    seen, unique = set(), []
    for l in out:
        if l["url"] not in seen:
            seen.add(l["url"])
            unique.append(l)
    return unique[:6]


def describe(title: str, why: str = "", how: str = "", pages: list[str] | None = None, effort: str | None = None, level: str | None = None, source: str = "",
             verify: str = "") -> str:
    """Plain-text description in a fixed shape: problem, why it matters, what to do, where, how long, and when it is done."""
    parts = [f"Problem: {title}."]
    if why:
        parts.append(f"Why it matters: {why}")
    if how:
        parts.append(f"What to do: {how}")
    if pages:
        parts.append(f"Pages affected ({len(pages)}): " + ", ".join(pages[:5]) + (" and more" if len(pages) > 5 else ""))
    if effort in EFFORT_HOURS:
        parts.append(f"Estimated effort: {EFFORT_HOURS[effort]}.")
    parts.append(verify or "Done when: the next audit no longer reports this problem (it then closes by itself as 'confirmed by audit').")
    return "\n".join(parts)


def decorate(cand: dict[str, Any], website: str | None, wk: date, gbp_url: str | None = None, today: date | None = None, platform: str | None = None,
             biz: dict[str, str] | None = None) -> date:
    """Add the description, test links, due date and priority label to a candidate's detail. Returns the due date for the work item."""
    d = cand["detail"]
    pages = [u for u in (d.get("pages") or []) if isinstance(u, str)]
    own = page_url(website, cand["title"])
    if own and own not in pages:
        pages = [own] + pages
    op = d.get("operation")
    d["priority_label"] = PRIORITY_LABEL.get(cand["priority"], "P3 Medium")
    if cand["source"] == "operation":
        d["description"] = describe(cand["title"].rstrip("."), how=d.get("how", ""), verify="Done when: the work is finished and ticked off here; it is repeated every week.")
        d["test_links"] = test_links("", website, [], area=op or "", gbp_url=gbp_url) if op in ("gbp-post", "reviews") else test_links("", website, [], area=op or "")
    else:
        code = cand["key"].split(":")[-1] if cand["source"] == "audit" else cand["key"].removeprefix("rec:")
        d["description"] = describe(cand["title"].rstrip("."), d.get("why", ""), d.get("how", ""), pages if len(pages) > 1 or not own else None, d.get("effort"), d.get("level"), cand["source"])
        preset = [{"label": a, "url": u} for a, u in (d.pop("links_preset", None) or []) if u]
        d["test_links"] = preset or test_links(d.get("audit_kind", ""), website, pages, code, f"{d.get('issue_area', '')} {cand['title']} {d.get('how', '')}"[:300], gbp_url)
    if cand["source"] != "operation" and not d.get("fix_help"):
        main = own or (pages[0] if pages else None)
        path = urlparse(main or "").path or "/"
        name = "Home" if path == "/" else path.strip("/").split("/")[-1].replace("-", " ").title()
        d["fix_help"] = fix_help(f"{cand['title']} {d.get('how', '')} {d.get('code') or ''}", platform, dict(biz or {}, website=website), main, name)
    return due_for(wk, cand["priority"], op, today)
