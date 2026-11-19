"""The order to work in once a project is onboarded: the website first, then the profiles.

Phase 1  Fix the website            every page and its data, in six steps (readable, titles, content, images and links, structured data, speed and security)
Phase 2  Google Business Profile    basics, services, photos / posts / reviews
Phase 3  Listings and local         directory listings, local rank and competitors
Phase 4  AI search and ChatGPT      the Business-in-ChatGPT checklist
Phase 5  Keep growing               keywords, blog, backlinks

Nothing here is a new measurement. Each existing fix task (services/growth_issues.py) is placed in a phase and step by what it is about, and the website's
page-by-page changes are read from the latest site crawl (services/crawler.py): for each crawled page, what its title, description, headings, text, images,
links and data need. A phase counts as done when none of its tasks and none of its page changes are left. "Re-scan my website" crawls the site again and
closes what the new scan no longer reports.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..models import Business
from . import crawler, fix_plan, growth_content, growth_issues

PHASES: list[dict[str, Any]] = [
    {"key": "website", "title": "Fix your website first", "goal": "Search engines and customers read your website before anything else. Make every page right before building profiles that point to it.",
     "steps": [
         {"key": "readable", "title": "Let search engines read every page", "why": "A page that cannot be crawled or is blocked cannot rank, whatever else is fixed."},
         {"key": "titles", "title": "Page titles and descriptions", "why": "The title and description are what people read in Google: each page needs its own."},
         {"key": "content", "title": "Headings and page content", "why": "One clear main heading and enough helpful text tell Google what each page is about."},
         {"key": "media", "title": "Images and links", "why": "Pictures need a description, and links need words that say where they lead."},
         {"key": "data", "title": "Structured data and answers", "why": "Business details and FAQ data help Google and AI assistants show and quote you correctly."},
         {"key": "speed", "title": "Speed, mobile and security", "why": "A fast, secure, mobile-friendly site keeps visitors and is a ranking signal."}]},
    {"key": "gbp", "title": "Build your Google Business Profile", "goal": "With the website right, complete the profile customers see in Google Search and Maps.",
     "steps": [
         {"key": "basics", "title": "Connect and complete the basics", "why": "Name, category, address, hours, phone and a description: the profile's foundation."},
         {"key": "services", "title": "Services, prices and details", "why": "Services and attributes help the profile match what people search for."},
         {"key": "proof", "title": "Photos, posts and reviews", "why": "Fresh photos, posts and reviews show the business is active and trusted."}]},
    {"key": "local", "title": "Listings and local ranking", "goal": "Put the same business details on other sites, then watch how you rank locally.",
     "steps": [
         {"key": "listings", "title": "Directory and social listings", "why": "The same name, address and phone everywhere builds trust with Google."},
         {"key": "rank", "title": "Local ranking and competitors", "why": "Track where you appear and what the businesses ahead of you do."}]},
    {"key": "ai", "title": "AI search and ChatGPT", "goal": "Make the business easy for AI assistants to find and describe correctly.",
     "steps": [{"key": "chatgpt", "title": "Business in ChatGPT", "why": "A verified profile, policies and a product feed that AI assistants can read."}]},
    {"key": "grow", "title": "Keep growing", "goal": "Steady work that builds on the finished foundation.",
     "steps": [
         {"key": "keywords", "title": "Keywords", "why": "Track the searches that matter and give each a page."},
         {"key": "blog", "title": "Blog and content", "why": "Helpful articles bring in people who are not looking for you by name yet."},
         {"key": "links", "title": "Backlinks and competitors", "why": "Links from other sites, and a look at what rivals do better."}]},
]
STEP_TITLE = {(p["key"], s["key"]): s["title"] for p in PHASES for s in p["steps"]}

_READABLE = ("onpage.noindex", "onpage.javascript_only", "onpage.http_error", "site.sitemap", "single_canonical", "canonical", "robots", "indexable", "redirect", "https_redirect", "http_error")
_TITLES = ("title", "description", "desc_", "meta.og_", "og_")
_CONTENT = ("h1", "heading", "thin_content", "word", "content")
_MEDIA = ("alt", "image", "link_text", "a11y_link", "outbound", "broken", "link")
_DATA = ("schema", "jsonld", "faq", "llms", "entity", "org_", "author", "answer", "localbusiness")
_SPEED = ("security.", "response_time", "viewport", "a11y_", "performance", "speed", "lcp", "cls", "ssl", "cert", "mobile", "compress", "cache")


def _has(key: str, words: tuple[str, ...]) -> bool:
    return any(w in key for w in words)


def step_of(task: dict[str, Any]) -> tuple[str, str]:
    """The (phase, step) a fix task belongs to, from its area and what it is about."""
    area, key = task.get("area") or "", (task.get("key") or "").lower().removeprefix("fix.")
    if area == "gmb":
        if _has(key, ("services", "prices", "attributes", "secondary_categories")):
            return "gbp", "services"
        if _has(key, ("photos", "posts", "reviews", "rating", "reply_rate", "logo", "cover")):
            return "gbp", "proof"
        return "gbp", "basics"
    if area == "local":
        return ("local", "listings") if key.startswith("listing.") else ("local", "rank")
    if area == "chatgpt":
        return "ai", "chatgpt"
    if key.startswith(("kw.", "kw_")):
        return "grow", "keywords"
    if key.startswith(("blog.", "blog_", "articles")):
        return "grow", "blog"
    if key.startswith(("bl.", "comp.", "backlinks")):
        return "grow", "links"
    # the website: seo, aeo and geo checks, audits and metadata
    if key.startswith("security.") or _has(key, _SPEED):
        return "website", "speed"
    if _has(key, _READABLE):
        return "website", "readable"
    if _has(key, _DATA) or area in ("aeo", "geo"):
        return "website", "data"
    if _has(key, _TITLES):
        return "website", "titles"
    if _has(key, _MEDIA):
        return "website", "media"
    if _has(key, _CONTENT):
        return "website", "content"
    return "website", "content"


# ------------------------------------------------------------------------------------------------------------------- page by page
def _path(url: str) -> str:
    return (urlsplit(url or "").path or "/") or "/"


def page_changes(crawl: dict[str, Any]) -> list[dict[str, Any]]:
    """For every crawled page that opened (and the ones that did not): what to change on it, each change placed in its website step. Read from the crawl only."""
    pages = [p for p in (crawl.get("pages") or []) if p.get("url")]
    titles: dict[str, list[str]] = {}
    descs: dict[str, list[str]] = {}
    for p in pages:
        if p.get("status") == 200:
            if (p.get("title") or "").strip():
                titles.setdefault(p["title"].strip().lower(), []).append(_path(p["url"]))
            if (p.get("meta_description") or "").strip():
                descs.setdefault(p["meta_description"].strip().lower(), []).append(_path(p["url"]))
    out = []
    for p in pages:
        path = _path(p["url"])
        items: list[dict[str, Any]] = []

        def add(step: str, code: str, level: str, title: str, fix: str, detail: str | None = None) -> None:
            items.append({"step": step, "code": code, "level": level, "title": title, "fix": fix, "detail": detail})

        if (p.get("status") or 0) >= 400:
            add("readable", "http_error", "critical", f"Page opens with error {p['status']}", "Fix the page or 301-redirect it to the closest live page.")
            out.append({"url": p["url"], "path": path, "status": p.get("status"), "changes": items})
            continue
        if p.get("javascript_only"):
            add("readable", "javascript_only", "critical", "Empty without JavaScript", "Serve the page's text in the HTML (server-side rendering or pre-rendering) so search engines and AI crawlers can read it.")
            out.append({"url": p["url"], "path": path, "status": p.get("status"), "changes": items})
            continue
        if p.get("noindex"):
            add("readable", "noindex", "critical", "The page is set to noindex", "Remove noindex if this page should appear in Google.")
        if not p.get("canonical"):
            add("readable", "no_canonical", "info", "No canonical address", "Add <link rel=\"canonical\"> pointing at this page's own address.")
        tl, dl = p.get("title_length") or 0, p.get("meta_description_length") or 0
        if not tl:
            add("titles", "missing_title", "serious", "No title", "Write a unique title of 50 to 60 characters with the main keyword near the start.")
        else:
            if tl > 60 or tl < 30:
                add("titles", "title_length", "warning", f"Title is {tl} characters", "Aim for 50 to 60 characters so Google shows all of it.", p.get("title"))
            if len(titles.get(p["title"].strip().lower(), [])) > 1:
                same = [x for x in titles[p["title"].strip().lower()] if x != path][:3]
                add("titles", "title_duplicate", "warning", "The same title is used on other pages", "Give every page its own title.", "Also on: " + ", ".join(same))
        if not dl:
            add("titles", "missing_description", "warning", "No meta description", "Write 140 to 160 characters that say what the page offers and why to click.")
        else:
            if dl < 70 or dl > 160:
                add("titles", "description_length", "info", f"Description is {dl} characters", "Aim for 140 to 160 characters.", p.get("meta_description"))
            if len(descs.get(p["meta_description"].strip().lower(), [])) > 1:
                add("titles", "description_duplicate", "info", "The same description is used on other pages", "Write a different description for each page.")
        if not (p.get("og_title") and p.get("og_description") and p.get("og_image")):
            add("titles", "no_social_preview", "info", "Incomplete social preview (Open Graph)", "Add og:title, og:description and og:image so links to this page look right when shared.")
        h1 = p.get("h1_count") or 0
        if h1 != 1:
            add("content", "h1_count", "warning", "No main heading (H1)" if h1 == 0 else f"{h1} main headings (H1)", "Use exactly one H1 that names the page's service and place.")
        wc = p.get("word_count") or 0
        if wc < 300:
            add("content", "thin_content", "warning", f"Only {wc} words", "Add the answers a visitor needs: what you offer, who it is for, prices or steps, FAQs, local details.")
        elif not p.get("h2_count"):
            add("content", "no_subheadings", "info", "No subheadings (H2)", "Break the text into sections with H2 headings.")
        if p.get("images_missing_alt"):
            add("media", "missing_alt", "info", f"{p['images_missing_alt']} image{'s' if p['images_missing_alt'] != 1 else ''} without alt text", "Describe each picture in a few words: what is shown, and the service or place.", ", ".join(_path(x) for x in (p.get("images_without_alt") or [])[:3]))
        if p.get("generic_link_text"):
            add("media", "generic_links", "info", f"{p['generic_link_text']} links that say only “click here” or “read more”", "Make the link words say where it leads, for example “see our bridal rental range”.")
        if not p.get("schema_types"):
            add("data", "no_schema", "warning", "No structured data", "Add JSON-LD that fits the page: LocalBusiness, Service or FAQPage.")
        if not p.get("has_viewport"):
            add("speed", "no_viewport", "serious", "Not set up for phones (no viewport tag)", "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.")
        out.append({"url": p["url"], "path": path, "status": p.get("status"), "changes": items})
    return out


def _site_changes(crawl: dict[str, Any]) -> list[dict[str, Any]]:
    """Changes that belong to the whole site, from the crawl's site-level facts."""
    site = crawl.get("site") or {}
    out = []
    if site and not site.get("robots_txt"):
        out.append({"step": "readable", "code": "no_robots", "level": "info", "title": "No robots.txt", "fix": "Add a robots.txt that allows search engines and points to the sitemap."})
    if site and site.get("robots_blocks_all"):
        out.append({"step": "readable", "code": "robots_blocks_all", "level": "critical", "title": "robots.txt blocks every search engine", "fix": "Remove “Disallow: /” for all user agents."})
    if site and not site.get("sitemap"):
        out.append({"step": "readable", "code": "no_sitemap", "level": "serious", "title": "No sitemap", "fix": "Create a sitemap.xml listing every page and submit it in Google Search Console."})
    return out


# ------------------------------------------------------------------------------------------------------------------- the plan
def plan(db: Session, b: Business) -> dict[str, Any]:
    ov = fix_plan.overview(db, b)
    crawl = growth_content._crawl(db, b)
    pages = page_changes(crawl) if crawl.get("pages") else []
    site = _site_changes(crawl) if crawl else []
    steps: dict[tuple[str, str], dict[str, Any]] = {}
    for ph in PHASES:
        for st in ph["steps"]:
            steps[(ph["key"], st["key"])] = {"key": st["key"], "title": st["title"], "why": st["why"], "tasks": [], "closed": [], "pages": [], "site": [], "page_total": 0}
    for t in ov["open"]:
        steps[step_of(t)]["tasks"].append(t)
    for t in ov["closed"]:
        steps[step_of(t)]["closed"].append(t)
    for c in site:
        steps[("website", c["step"])]["site"].append(c)
    for pg in pages:
        by_step: dict[str, list[dict[str, Any]]] = {}
        for c in pg["changes"]:
            by_step.setdefault(c["step"], []).append(c)
        for step, cs in by_step.items():
            s = steps[("website", step)]
            s["pages"].append({"url": pg["url"], "path": pg["path"], "changes": cs})
            s["page_total"] += len(cs)
    phases, current = [], None
    has_site = bool((b.website or "").strip())
    has_scan = bool(crawl.get("pages"))
    from . import project_services
    on = project_services.enabled(b)
    needs = {"gbp": "gmb" in on, "local": "gmb" in on, "ai": "geo" in on or "aeo" in on}  # a project that does SEO only is not given the Google profile or AI phases
    for ph in PHASES:
        if not needs.get(ph["key"], True):
            continue
        out_steps, open_n, done_n = [], 0, 0
        for st in ph["steps"]:
            s = steps[(ph["key"], st["key"])]
            n_open = len(s["tasks"]) + s["page_total"] + len(s["site"])
            n_done = len(s["closed"])
            s["open"], s["done"], s["state"] = n_open, n_done, ("todo" if n_open else "done" if n_done or (ph["key"] == "website" and has_scan) else "empty")
            s["pages"].sort(key=lambda x: (-len(x["changes"]), x["path"]))
            open_n += n_open
            done_n += n_done
            out_steps.append(s)
        phases.append({"key": ph["key"], "title": ph["title"], "goal": ph["goal"], "steps": out_steps, "open": open_n, "done": done_n,
                       "state": "todo" if open_n else "done" if done_n or (ph["key"] == "website" and has_scan) else "empty"})
    first = next((p for p in phases if p["state"] == "todo"), None)
    for p in phases:
        # "empty": nothing was found or recorded yet (the first scan, or connecting the profile, creates the tasks); it is not "done"
        p["status"] = "done" if p["state"] == "done" else "empty" if p["state"] == "empty" else "current" if p is first else "next"
    cur_step = next((s for s in (first["steps"] if first else []) if s["open"]), None)
    return {"has_website": has_site, "crawled": bool(crawl.get("pages")), "crawl_date": crawl.get("_found"), "pages_crawled": len(crawl.get("pages") or []),
            "phases": phases, "current": {"phase": first["key"], "step": cur_step["key"]} if first and cur_step else None, "total_open": sum(p["open"] for p in phases),
            "areas": ov["areas"], "note": None if crawl.get("pages") or not has_site else "The website has not been crawled yet: press “Re-scan my website” to list the changes page by page."}


def rescan(db: Session, b: Business) -> dict[str, Any]:
    """Crawl the website again and re-check everything, so fixed changes drop away and tasks whose issue is gone close. Returns the new plan and what changed."""
    from . import audits
    if not (b.website or "").strip():
        raise ValueError("Add the project's website first.")
    before = plan(db, b)
    a = audits.run(db, b, "onpage")
    if a.status != "done":
        raise ValueError(a.error or "The website could not be crawled.")
    growth_issues.sweep(db, b, live=True)
    db.commit()
    after = plan(db, b)
    was = {p["key"]: p["open"] for p in before["phases"]}
    return {**after, "result": {"phases": {p["key"]: {"before": was.get(p["key"]), "after": p["open"]} for p in after["phases"]}, "fixed": max(0, before["total_open"] - after["total_open"])}}
