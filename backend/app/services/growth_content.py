"""Keywords, content, metadata, sitemap and backlinks as growth issues, and the one safe automatic action (grouping keywords).

What it looks at (real data only; nothing is invented):
  - the tracked keywords: how many, whether they are grouped into topics, whether each has a page assigned
  - competitor research: searches rivals rank for that the project does not track yet
  - where the main keywords are USED: website (title, description, headings), Google profile (description, services, feed), Google posts and blog articles
  - page metadata from the latest site crawl: titles, descriptions, social image, canonical, duplicates
  - the sitemap, the blog's recent output, and the backlinks our own bot has found
Each finding becomes a fix task (growth_issues.make) with the exact page to land on. A fix task closes only when this data stops showing the problem.
"""
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, CatalogItem, Keyword, Post

KINDS = {"blog_published", "blog_promo", "competitors_clean", "kw_terms", "bl_prospect", "kw_count", "kw_grouped", "kw_targets", "kw_gap", "kw_used", "audit_probe", "backlinks", "articles_since", "articles_meta", "competitors_done", "comp_reviews", "comp_listings"}
STOP = {"in", "near", "me", "the", "best", "top", "for", "a", "an", "of", "and", "to", "at", "on", "with", "by", "cheap", "affordable", "my", "your", "nearby", "online", "is", "are", "how", "what"}
JS_SENSITIVE = {"meta.h1_missing", "meta.alt"}
SURFACES = {
    "website": ("the website pages (title, description, headings)", "/page-xray", "Add it to the page title, meta description and a heading of the page that serves it."),
    "profile": ("the Google profile (description and categories)", "/gmb-profile/profile?sub=edit&step=about", "Mention it naturally in the business description. Never stuff keywords into the business name."),
    "services": ("service names and descriptions (profile and ChatGPT feed)", "/gmb-profile/profile?sub=edit&step=services", "Name a service after it and describe it in one sentence with a price if you show one."),
    "posts": ("Google posts", "/google-posts", "Write a post about the service using these words naturally, with a photo and a call to action."),
    "alt": ("image alt text on the homepage", "/page-xray", "Describe the main photos with the service and the place in a few words, for example “bridal lehenga rental in Pune”. Describe what is in the picture: never a list of keywords."),
    "blog": ("blog articles", "/ai-content-generation/blog", "Write one helpful article for each keyword (the AI Blog Studio drafts it; you review and publish)."),
}


def _words(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower().replace("’", "'"))


def _count(v: Any) -> int:
    return len(v) if isinstance(v, (list, tuple)) else int(v or 0)


def _when(a: Any) -> datetime:
    d = a.generated_at or a.created_at
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _norm(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def core(keyword: str) -> list[str]:
    return [_norm(w) for w in _words(keyword) if w not in STOP]


def has_keyword(corpus: set[str], keyword: str) -> bool:
    c = core(keyword)
    return bool(c) and all(w in corpus for w in c)


def _corpus(texts: list[str | None]) -> set[str]:
    return {_norm(w) for t in texts for w in _words(t)}


# ------------------------------------------------------------------------------------------------------------------- data
def _crawl(db: Session, b: Business) -> dict[str, Any]:
    from . import audits
    a = audits.latest(db, b).get("onpage")
    if a is None or a.status != "done" or a.data_source == "sample":
        return {}
    return {**(a.result or {}), "_found": a.finished_at.date().isoformat() if a.finished_at else None}


def tracked(db: Session, b: Business) -> list[Keyword]:
    rows = list(db.scalars(select(Keyword).where(Keyword.business_id == b.id, Keyword.tracked.is_(True))))
    return sorted(rows, key=lambda k: -(k.volume or 0))


def _brand(b: Business) -> set[str]:
    return {_norm(w) for w in _words(b.name)} | {_norm(w) for w in re.split(r"[^a-z0-9]+", (b.website or "").lower().replace("www.", "").split("/")[-1] if "//" not in (b.website or "") else (b.website or "").lower().split("//")[1].split("/")[0].replace("www.", "")) if len(w) > 3}


def _brand_strict(b: Business) -> set[str]:
    """Only the brand itself: the name's first word and the website's domain words. A name like "Asha Rental" must not hide the word that says what the business does."""
    first = _norm(next(iter(_words(b.name)), ""))
    domain = {w for w in _brand(b) if w not in {_norm(x) for x in _words(b.name)}}
    return {first} | domain


def _main_keywords(b: Business, rows: list[Keyword], n: int = 6) -> list[str]:
    """The keywords worth placing in content: a few words, and not the brand name itself (a brand search needs no keyword work)."""
    brand = _brand(b)
    return [k.keyword for k in rows if 1 <= len(core(k.keyword)) and len(_words(k.keyword)) <= 6 and not set(core(k.keyword)) <= brand][:n]


FLUFF = {"premium", "quality", "affordable", "leading", "trusted", "professional", "perfect", "special", "services", "service", "solutions", "welcome", "home", "about", "contact", "your", "with", "from", "that", "this", "best", "great"}


def site_terms(b: Business, report: dict[str, Any] | None, crawl: dict[str, Any]) -> list[str]:
    """The words the website itself uses to say what it is: significant words found in at least two of its homepage title, main heading and meta description (brand, place and filler words left out)."""
    titles, h1s, descs = [], [], []
    if report:
        titles.append(((report.get("meta") or {}).get("title")) or "")
        descs.append(((report.get("meta") or {}).get("description")) or "")
        h1s.append(" ".join(x.get("text", "") for x in ((report.get("content") or {}).get("outline") or []) if x.get("level") == 1))
    home = next((p for p in (crawl.get("pages") or []) if re.sub(r"^https?://[^/]+", "", p.get("url", "")) in ("", "/")), None)
    if home:
        titles.append(home.get("title") or "")
        descs.append(home.get("meta_description") or "")
        h1s.append(home.get("h1") if isinstance(home.get("h1"), str) else " ".join(home.get("h1") or []))
    skip = _brand_strict(b) | {_norm(w) for w in _words(b.city or "")} | {_norm(w) for w in _words(b.area or "")} | FLUFF
    groups = [{_norm(w) for t in g for w in _words(t) if w not in STOP and len(w) >= 4} - skip for g in (titles, h1s, descs)]
    counts = Counter(w for g in groups for w in g)
    return sorted(w for w, n in counts.items() if n >= 2)


def site_phrases(b: Business, report: dict[str, Any] | None, crawl: dict[str, Any], rows: list[Keyword], limit: int = 3) -> list[str]:
    """Searches built from the website's own words that no tracked keyword has yet: the two-word phrase of its title or heading that holds the uncovered term, with the city ("clothing rental in pune")."""
    terms = [t for t in site_terms(b, report, crawl) if not _covered(t, rows)]
    if not terms:
        return []
    texts = []
    if report:
        texts += [((report.get("meta") or {}).get("title")) or ""] + [x.get("text", "") for x in ((report.get("content") or {}).get("outline") or []) if x.get("level") == 1]
    for p in crawl.get("pages") or []:
        if re.sub(r"^https?://[^/]+", "", p.get("url", "")) in ("", "/"):
            texts += [p.get("title") or "", p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])]
    city = " ".join(_words(b.city or "")).strip()
    out: list[str] = []
    for t in terms:
        phrase = t
        for text in texts:
            ws = [w for w in _words(text)]
            for i, w in enumerate(ws):
                if _norm(w) == t:
                    pair = [x for x in ws[max(0, i - 1): i + 2] if x not in STOP and len(x) >= 4 and _norm(x) not in FLUFF and _norm(x) not in _brand_strict(b)]
                    if len(pair) >= 2 and ws[max(0, i - 1)] in pair:
                        phrase = " ".join(pair[:2])
                    break
            if phrase != t:
                break
        kw = f"{phrase} in {city}" if city else phrase
        if kw not in out and not any(kw == k.keyword for k in rows):
            out.append(kw)
    return out[:limit]


def add_site_keywords(db: Session, b: Business, report: dict[str, Any] | None = None) -> list[str]:
    """Track the searches the website itself is about (only when tracked keywords ignore its main words). Never removes or changes a keyword."""
    from .providers.base import intent_of
    rows = tracked(db, b)
    if not rows or len(rows) >= 12:
        return []
    made = []
    for kw in site_phrases(b, report, _crawl(db, b), rows):
        if db.scalar(select(Keyword.id).where(Keyword.business_id == b.id, Keyword.keyword == kw)):
            continue
        db.add(Keyword(business_id=b.id, keyword=kw, tracked=True, intent=intent_of(kw)))
        made.append(kw)
    db.flush()
    return made


def _covered(term: str, rows: list[Keyword]) -> bool:
    return any(w[:5] == term[:5] for k in rows for w in core(k.keyword))


def surfaces_text(db: Session, b: Business, report: dict[str, Any] | None, crawl: dict[str, Any]) -> dict[str, set[str]]:
    since = datetime.now(timezone.utc) - timedelta(days=120)
    pages = crawl.get("pages") or []
    site = [((report or {}).get("meta") or {}).get("title"), ((report or {}).get("meta") or {}).get("description")] + [x.get("text") for x in ((report or {}).get("content") or {}).get("outline", []) if x.get("level", 9) <= 2]
    for p in pages:
        site += [p.get("title"), p.get("meta_description"), p.get("h1") if isinstance(p.get("h1"), str) else " ".join(p.get("h1") or [])]
    prof = [b.description, b.primary_category, " ".join(b.secondary_categories or [])]
    svc = [f"{s.get('name', '')} {s.get('description', '')}" if isinstance(s, dict) else str(s) for s in (b.services or [])]
    svc += [f"{c.title} {c.description or ''}" for c in db.scalars(select(CatalogItem).where(CatalogItem.business_id == b.id))]
    posts = [f"{p.title or ''} {p.body or ''}" for p in db.scalars(select(Post).where(Post.business_id == b.id, Post.status == "published")) if p.published_at is None or (p.published_at if p.published_at.tzinfo else p.published_at.replace(tzinfo=timezone.utc)) >= since]
    arts = [f"{a.title or ''} {a.keyword or ''} {' '.join(a.secondary_keywords or [])} {a.body or ''}" for a in db.scalars(select(Article).where(Article.business_id == b.id, Article.status == "completed"))]
    alts = ((report or {}).get("content") or {}).get("images", {}).get("alts") or []
    return {"alt": _corpus(alts), "website": _corpus(site), "profile": _corpus(prof), "services": _corpus(svc), "posts": _corpus(posts), "blog": _corpus(arts)}


# ------------------------------------------------------------------------------------------------------------------- the metadata and sitemap probes (recomputed from any site crawl)
def probes(crawl: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """{code: {title, why, how, severity, items}} for what the crawl shows is wrong with page metadata and the sitemap."""
    out: dict[str, dict[str, Any]] = {}
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200 and not p.get("noindex")]
    if not pages:
        return out

    def add(code: str, title: str, why: str, how: list[str], sev: str, items: list[str]) -> None:
        if items:
            out[code] = {"title": f"{title} ({len(items)} page{'s' if len(items) != 1 else ''})", "why": f"{why} Pages: {', '.join(items[:6])}{' and more' if len(items) > 6 else ''}.", "how": how, "severity": sev, "items": items}
    path = lambda p: (re.sub(r"^https?://[^/]+", "", p.get("url", "")) or "/")  # noqa: E731
    add("meta.title_missing", "Add page titles", "These pages have no title tag, so Google writes one for them.", ["Write a unique title of 30 to 60 characters for each: main keyword, place, brand.", "Set it in the page's SEO settings."], "serious", [path(p) for p in pages if not (p.get("title") or "").strip()])
    add("meta.title_length", "Fix page title length", "Titles under 25 or over 65 characters are cut off in results or say too little.", ["Rewrite them to 30 to 60 characters with the main keyword first."], "warning",
        [path(p) for p in pages if (p.get("title") or "").strip() and not 25 <= _count(p.get("title_length") or len(p["title"])) <= 65])
    titles = Counter((p.get("title") or "").strip().lower() for p in pages if (p.get("title") or "").strip())
    add("meta.title_duplicate", "Make duplicate titles unique", "Several pages share one title, so Google cannot tell what each page is about.", ["Give every page its own title that names what is on that page."], "warning", [path(p) for p in pages if titles[(p.get("title") or "").strip().lower()] > 1])
    add("meta.desc_missing", "Add meta descriptions", "These pages have no meta description, so Google picks random text for the snippet.", ["Write 70 to 160 characters per page: what it offers and a reason to click.", "Use the page's keyword once, naturally."], "warning", [path(p) for p in pages if not (p.get("meta_description") or "").strip()])
    add("meta.desc_length", "Fix meta description length", "Descriptions under 50 or over 170 characters are cut off or too thin.", ["Rewrite them to 70 to 160 characters."], "info",
        [path(p) for p in pages if (p.get("meta_description") or "").strip() and not 50 <= _count(p.get("meta_description_length") or len(p["meta_description"])) <= 170])
    descs = Counter((p.get("meta_description") or "").strip().lower() for p in pages if (p.get("meta_description") or "").strip())
    add("meta.desc_duplicate", "Make duplicate descriptions unique", "Several pages share one description.", ["Write a description for each page from what it actually offers."], "info", [path(p) for p in pages if descs[(p.get("meta_description") or "").strip().lower()] > 1])
    add("meta.h1_missing", "Give each page one H1", "These pages have no H1 heading.", ["Add one H1 that says what the page is about, with its keyword."], "warning", [path(p) for p in pages if _count(p.get("h1_count")) == 0])
    add("meta.og_image", "Add a social image to pages", "Pages without an og:image look empty when shared on WhatsApp, Facebook and LinkedIn.", ["Set a 1200 x 630 og:image for each page (the SEO plugin has a field)."], "info", [path(p) for p in pages if not p.get("og_image")])
    add("meta.canonical", "Add canonical tags", "Pages without a canonical tag can be indexed under several addresses.", ["Set each page's canonical to its own clean https address."], "info", [path(p) for p in pages if not p.get("canonical")])
    add("meta.alt", "Add alt text to images", "Images without alt text are invisible to search and screen readers.", ["Describe each meaningful image in a few words."], "info", [path(p) for p in pages if _count(p.get("images_missing_alt") or p.get("images_without_alt")) > 0])
    n_crawled, n_map = _count(crawl.get("crawled")) or len(pages), _count(crawl.get("sitemap_urls") or crawl.get("sitemap_pages"))
    if not crawl.get("sitemap"):
        out["sitemap.missing"] = {"title": "Create and submit an XML sitemap", "why": "No sitemap was found at /sitemap.xml, so search engines must discover every page by following links.", "severity": "serious",
                                  "how": ["Generate sitemap.xml (the SEO plugin or the website builder does it).", "Add the line Sitemap: https://your-site/sitemap.xml to robots.txt.", "Submit it in Google Search Console."], "items": []}
    elif n_crawled and n_map < n_crawled * 0.8:
        out["sitemap.incomplete"] = {"title": f"Add the missing pages to the sitemap ({n_map} listed, {n_crawled} found)", "why": f"The sitemap lists {n_map} pages but the crawl found {n_crawled}. Pages missing from the sitemap are found later.",
                                     "severity": "warning", "how": ["Regenerate the sitemap so it includes every public page.", "Leave out pages marked noindex."], "items": []}
    return out


# ------------------------------------------------------------------------------------------------------------------- the issues
def _gap_ideas(db: Session, b: Business, have: set[str]) -> list[dict[str, Any]]:
    from . import keywords
    ideas = keywords.competitor_ideas(keywords.competitor_research(db, b))
    own = surfaces_text(db, b, None, _crawl(db, b))
    mine = own["profile"] | own["website"] | own["services"]
    generic = {"local", "search", "engine", "directory", "listing", "service", "business", "near", "company", "rental", "rent", "hire", "subscription", "self", "drive", "online", "shop", "store", "market", "cheap", "best", "price", "book", "booking"}
    place = {_norm(w) for w in _words(f"{b.city or ''} {b.area or ''}")}

    def relevant(kw: str) -> bool:  # a rival's page can target things that are not what this business sells: keep only searches that share a real word with the business
        shared = [w for w in core(kw) if w in mine and w not in generic and w not in place]
        return bool(shared)  # a real product or service word, not "rental" or the city: a car-rental rival's keyword shares only those
    return [i for i in ideas if i["keyword"] not in have and 1 <= len(_words(i["keyword"])) <= 6 and "'" not in i["keyword"] and relevant(i["keyword"])][:8]


def issues(db: Session, b: Business, report: dict[str, Any] | None) -> list[dict[str, Any]]:
    from .growth_issues import make
    out: list[dict[str, Any]] = []
    rows = tracked(db, b)
    have = {k.keyword for k in rows}
    crawl = _crawl(db, b)
    url = (report or {}).get("final_url") or (report or {}).get("url") or b.website or ""
    n = len(rows)
    # ---- keywords
    if n < 8:
        out.append(make("kw.few", "seo", "keywords", "serious" if n < 3 else "warning", f"Research and track more keywords ({n} tracked)",
                        f"Only {n} keyword{'s are' if n != 1 else ' is'} tracked. Rankings, content and posts can only target what is tracked; a healthy local project tracks at least 8 (service + place, service + near me, questions customers ask).",
                        ["Open Find Keywords and press Discover: it builds searches from your services, area and competitors.", "Add the ones with real volume and a clear intent; do not add unrelated keywords.", "Press Seed keywords on Position Tracking for the basics."], 25, "/keyword-management/discover",
                        {"type": "kw_count", "min": 8}))
    terms = [t for t in site_terms(b, report, crawl) if not _covered(t, rows)]
    if terms and rows:
        city = (b.city or "").strip()
        ideas = [f"{t} in {city}" if city else t for t in terms[:3]] + ([f"{(b.primary_category or '').lower()} {terms[0]}".strip()] if b.primary_category else [])
        out.append(make("kw.site_terms", "seo", "keywords", "serious", f"Your keywords do not use what your website says ({', '.join(terms[:3])})",
                        f"Your homepage (title, heading and description) is about “{' '.join(terms[:3])}”, but none of your {n} tracked keywords contains {'it' if len(terms) == 1 else 'them'}. Keywords that do not match the site cannot rank, and content written for them will feel off.",
                        [f"Add keywords that use these words, for example: {'; '.join(ideas)}.", "Open Find Keywords to check their volume before tracking them.", "If a tracked keyword no longer describes the business (for example an old category), untrack it."], 20, "/keyword-management/discover",
                        {"type": "kw_terms", "terms": terms}))
    ungrouped = [k.keyword for k in rows if not (k.cluster or "").strip()]
    if ungrouped:
        out.append(make("kw.ungrouped", "seo", "keywords", "warning", f"Group the keywords into topics ({len(ungrouped)} ungrouped)",
                        f"{len(ungrouped)} tracked keywords belong to no topic group, so one page or post cannot be planned per topic: {', '.join(ungrouped[:6])}.",
                        ["Start plan groups them automatically by their shared words.", "Or open Keyword Strategy Builder and group them by hand.", "One topic group = one page or article that targets it."], 10, "/keyword-management/topics", {"type": "kw_grouped"}))
    pages = [p for p in (crawl.get("pages") or []) if p.get("status") == 200]
    untargeted = [k for k in rows if not (k.target_url or "").strip()]
    if untargeted:
        def best(kw: str) -> str | None:
            c = core(kw)
            scored = [(sum(1 for w in c if w in _corpus([p.get("title"), p.get("h1") if isinstance(p.get("h1"), str) else "", p.get("url")])), p["url"]) for p in pages]
            sc, u = max(scored, default=(0, None))
            return u if c and sc == len(c) else None
        hints = [f"“{k.keyword}” → {best(k.keyword) or 'no page covers it yet: create one'}" for k in untargeted[:5]]
        out.append(make("kw.no_target", "seo", "keywords", "warning", f"Give each keyword a page to rank with ({len(untargeted)} have none)", f"{len(untargeted)} tracked keywords have no target page, so nothing on the website is built to rank for them. Suggested: {'; '.join(hints)}.",
                        ["For each keyword pick the page that answers it, or create a new page.", "Set it as the keyword's target page in Keyword Management.", "Put the keyword in that page's title, H1 and first paragraph."], 20, "/keyword-management/tracked", {"type": "kw_targets"}))
    # ---- competitor research and gaps
    from ..competitors import hygiene
    bad = hygiene.invalid_rows(db, b)
    bad_targets = hygiene.invalid_targets(db, b)
    if bad or bad_targets:
        out.append(make("comp.invalid", "local", "competitors", "warning", f"Remove entries that are not competitors ({len(bad) + len(bad_targets)})",
                        "These saved competitors are not competitors' own websites, so audits, keyword gaps and the backlink gap use the wrong data: " + "; ".join([f"{c.name or c.website} ({why.rstrip('.')})" for c, why in bad[:5]] + [f"{d} tracked in Backlink Intelligence ({why.rstrip('.')})" for d, why in bad_targets[:5]]) + ".",
                        ["Open Competitors and remove each saved entry (the business itself is not touched).", "In Backlink Intelligence, remove the matching tracked targets: they make link reads very slow.", "Add real competitors instead: businesses with their own website that rank for your searches."], 10, "/competitor-finder?tab=competitors", {"type": "competitors_clean"}))
    from . import keywords as kwsvc
    if kwsvc.competitor_research(db, b) is None:
        out.append(make("comp.none", "local", "competitors", "warning", "Run the competitor research", "No competitor research has finished for this project, so keyword gaps, link gaps and rivals' strategies are unknown.",
                        ["Open Competitors and run the research (it uses your tracked searches and location).", "Review the rivals it finds and remove any that are not real competitors."], 15, "/competitor-finder", {"type": "competitors_done"}))
    else:
        gaps = _gap_ideas(db, b, have)
        if gaps:
            out.append(make("kw.gap", "seo", "competitors", "warning", f"Add the keywords competitors win ({len(gaps)} found)", "Competitors rank for these searches and you do not track them: " + "; ".join(f"“{g['keyword']}” ({g['reason']})" for g in gaps[:5]) + ".",
                            ["Open Find Keywords or the Keyword gap tab on Competitors and add the relevant ones.", "Skip any that do not match a service you really offer.", "Then plan a page or article for each."], 15, "/competitor-finder?tab=gap", {"type": "kw_gap", "keywords": [g["keyword"] for g in gaps]}))
    research = kwsvc.competitor_research(db, b)
    if research:
        top = (research.get("summary") or {}).get("local_leader") or {}
        mine_reviews = int((research.get("business") or {}).get("reviews") or b.review_count or 0)
        lead = int(top.get("reviews") or 0)
        if lead > mine_reviews:
            target = min(lead, mine_reviews + max(10, (lead - mine_reviews) // 4))  # a realistic next step, not the leader's total
            out.append(make("comp.reviews", "local", "competitors", "serious" if lead > 2 * max(mine_reviews, 1) else "warning", f"Close the review gap with {top.get('name') or 'the Maps leader'} ({mine_reviews} vs {lead:,} reviews)",
                            f"{top.get('name') or 'The leader in Google Maps'} has {lead:,} reviews and you have {mine_reviews:,}. Reviews are one of the strongest Maps ranking signals.",
                            [f"Ask recent happy customers for a review: share your Google review link by message or at the counter (aim for {target:,} reviews).", "Reply to every review, good or bad.", "Never buy or trade reviews: Google removes them and can suspend the profile."], 30, "/reviews",
                            {"type": "comp_reviews", "target": target}, found_at="competitor research"))
        listing_gaps = [g["domain"] for g in ((research.get("gaps") or {}).get("listings") or [])][:5]
        if listing_gaps:
            out.append(make("comp.listings", "seo", "competitors", "info", f"Get listed where competitors are listed ({', '.join(listing_gaps[:3])})",
                            "Competitors are listed on these sites and they rank for your searches. Each listing is a link and a citation with your name, address and phone: " + ", ".join(listing_gaps) + ".",
                            ["Open each site and create or claim a free listing with exactly the same name, address and phone as your Google profile.", "Add your website, category, hours and photos.", "Run the competitor research again: it confirms where you are now listed."], 45, "/off-page-seo",
                            {"type": "comp_listings", "domains": listing_gaps}, found_at="competitor research"))
    # ---- where the main keywords are used
    main = _main_keywords(b, rows)
    if main:
        text = surfaces_text(db, b, report, crawl)
        by_topic: dict[str, list[str]] = {}
        for k in rows:
            if k.keyword in main and (k.cluster or "").strip():
                by_topic.setdefault(k.cluster.strip(), []).append(k.keyword)
        topics = sorted(by_topic.items(), key=lambda kv: -sum((next((x.volume for x in rows if x.keyword == w), 0) or 0) for w in kv[1]))[:4]
        groups = [(None, main)] if not topics else [(t, ks) for t, ks in topics]  # one group per topic once keywords are grouped, else all main keywords together
        for topic, kws in groups:
            for surface, (label, link, how) in SURFACES.items():
                if surface == "website" and not (report or crawl):
                    continue
                if surface == "alt" and (not report or "alts" not in ((report.get("content") or {}).get("images") or {})):
                    continue  # an older X-Ray did not read the alt texts: say nothing rather than guess
                missing = [k for k in kws if not has_keyword(text[surface], k)]
                if surface == "alt" and len(kws) > 1:
                    missing = missing[:2]  # an image describes one thing: ask for the leading keywords only
                if not missing:
                    continue
                target = f"{link}?url={quote(url, safe='')}" if surface == "website" and url else link
                tag = f"kw.use.{surface}" + (f".{re.sub(r'[^a-z0-9]+', '-', topic.lower())[:24]}" if topic else "")
                where = label.split(" (")[0]
                title = f"Use “{topic}” keywords in {where}" if topic else f"Use your keywords in {where} ({len(missing)} of {len(kws)} missing)"
                out.append(make(tag, "seo" if surface in ("website", "blog") else "gmb", "keywords", "warning" if len(missing) >= max(2, len(kws) // 2) else "info", title,
                                f"{'Topic “' + topic + '”: ' if topic else ''}these keywords do not appear in {label}: {', '.join('“' + m + '”' for m in missing)}.", [how, "Write for people first; use each keyword once or twice, not repeatedly."], 25, target,
                                {"type": "kw_used", "surface": surface, "keywords": missing}))
    # ---- metadata and sitemap from the crawl
    js_built = bool(report and (report.get("rendering") or {}).get("js_required"))
    for code, p in probes(crawl).items():
        sev, conf, note = p["severity"], "confirmed", None
        if js_built and code in JS_SENSITIVE:  # the crawler read plain HTML; this site draws its content with JavaScript
            sev, conf, note = "info", "check_first", "The site crawler reads the plain HTML and this website is built with JavaScript, so it may not see headings or images that a browser shows. Open the page in Page X-Ray (Chrome) and confirm before fixing."
        out.append(make(f"site.{code}", "seo", "audit:onpage", sev, p["title"], p["why"], p["how"], 25, "/website-audit", {"type": "audit_probe", "code": code}, found_at=crawl.get("_found"), confidence=conf, note=note))
    # ---- backlinks
    unreadable = False
    try:
        bounded(db, 15)
        bl = _own_links(db, b)
    except Exception:  # noqa: BLE001 - the link store is slow or unavailable: say nothing about backlinks rather than invent a number
        db.rollback()
        bl, unreadable = False, True
    finally:
        if db.get_bind().dialect.name == "postgresql":
            try:
                from sqlalchemy import text
                db.execute(text("SET LOCAL statement_timeout = 0"))
            except Exception:  # noqa: BLE001
                db.rollback()
    if unreadable:
        pass
    elif bl is None:
        out.append(make("bl.none", "seo", "backlinks", "warning", "Start tracking your backlinks", "The project does not track its own website's backlinks, so link growth cannot be measured.", ["Open Backlink Intelligence and add your website as the tracked site.", "Press Run to let the crawler look for links."], 10, "/backlinks/links",
                        {"type": "backlinks", "min": 1, "field": "tracked"}))
    elif bl["referring_domains"] < 10:
        out.append(make("bl.few", "seo", "backlinks", "serious" if bl["referring_domains"] < 3 else "warning", f"Earn more backlinks ({bl['referring_domains']} referring domains)", f"Only {bl['referring_domains']} websites link to {bl['domain']} ({bl['backlinks']} links). Quality links from real sites are a top ranking signal.",
                        ["Claim your listings on directories and local chambers (Listing Management).", "Ask suppliers, partners and event organisers you work with to link to you.", "Publish something worth linking to (a guide, a local list, a case study).", "Use Link Building Tasks and the Backlink Gap for ready prospects.", "Never buy links or join link schemes: they cause penalties."], 40, "/backlinks/opportunities",
                        {"type": "backlinks", "min": 10}))
    # ---- blog output
    arts = list(db.scalars(select(Article).where(Article.business_id == b.id)))
    since = datetime.now(timezone.utc) - timedelta(days=30)
    recent = [a for a in arts if a.status == "completed" and _when(a) >= since]
    if not recent:
        uncovered = next((k for k in main if not has_keyword(surfaces_text(db, b, report, crawl)["blog"], k)), None) if main else None
        out.append(make("blog.none", "seo", "content", "warning", "Publish a blog article this month", "No article was written in the last 30 days." + (f" “{uncovered}” has no article yet." if uncovered else "") + " Fresh, helpful content earns long-tail searches and gives posts and the website something new.",
                        ["Open AI Blog Studio and pick a topic" + (f" such as “{uncovered}”" if uncovered else "") + ".", "Review and edit the draft: add real details, prices, photos and your area.", "Publish it to the website and share it as a Google post."], 45, "/ai-content-generation/blog",
                        {"type": "articles_since", "days": 30, "min": 1}))
    thin = [a for a in arts if a.status == "completed" and not (a.meta_description or "").strip()]
    if thin:
        out.append(make("blog.meta", "seo", "content", "info", f"Add meta descriptions to articles ({len(thin)} missing)", f"{len(thin)} articles have no meta description: {', '.join((a.title or a.keyword)[:40] for a in thin[:4])}.", ["Open each article and write 70 to 160 characters that include its keyword.", "Add alt text to the featured image."], 15, "/ai-content-generation/blog", {"type": "articles_meta"}))
    return out


def bounded(db: Session, seconds: int = 20) -> None:
    """Limit every query of this transaction: the link graph is large and a competitor-gap read can run for minutes. A timeout raises and the caller reports it."""
    from sqlalchemy import text
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text(f"SET LOCAL statement_timeout = {int(seconds) * 1000}"))


def add_prospects(db: Session, b: Business, today: date) -> dict[str, Any]:
    """Create one outreach task per backlink prospect (Start plan only: never inside the sweep). Returns {created, note}."""
    from .growth_issues import add_issues
    try:
        bounded(db, 6)  # per statement: the gap runs several; the first slow one stops it
        bl = _own_links(db, b)
        found = _prospect_issues(db, b, bl)
    except Exception as exc:  # noqa: BLE001 - too slow or unavailable: say so, nothing is invented
        db.rollback()
        return {"created": 0, "note": f"The competitor link gap could not be read right now ({type(exc).__name__}). Open Backlink Gap to look at it yourself."}
    return {"created": add_issues(db, b, found, today), "note": None if found else "No competitor link gap to work from yet (add competitors in Backlink Intelligence and let the crawler run)."}


def _own_links(db: Session, b: Business) -> dict | None:
    from ..backlinks import summary
    return summary.own_site_links(db, b.id)


def _gap(db: Session, b: Business) -> tuple[str, list[dict]]:
    from ..backlinks import analytics
    from ..backlinks.models import BiTrackedTarget
    targets = list(db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id)))
    mine = next((t.domain for t in targets if not t.is_competitor), None)
    from ..competitors import hygiene
    comps = [d for d in hygiene.saved_competitor_domains(db, b) if d != mine]  # every saved competitor, not only the Backlink Intelligence targets
    if not mine or not comps:
        return mine or "", []
    return mine, analytics.gap(db, mine, comps)


def _prospect_issues(db: Session, b: Business, bl: dict | None) -> list[dict[str, Any]]:
    from .growth_issues import make
    if bl is None:
        return []
    mine, gap = _gap(db, b)
    out = []
    for g in gap[:5]:
        n = len(g["competitors"])
        out.append(make(f"bl.prospect.{re.sub(r'[^a-z0-9]+', '-', g['domain'])[:50]}", "seo", "backlinks", "info", f"Ask {g['domain']} for a link",
                        f"{g['domain']} links to {n} of your competitors ({g['backlinks']} link{'s' if g['backlinks'] != 1 else ''}) but not to {mine}. A relevant site that already links to rivals is a realistic prospect.",
                        [f"Open {g['domain']} and find the page that links to your competitor: what is it (directory, guide, supplier list, press)?", "Decide honestly whether your business belongs there. If not, skip this task with a reason.",
                         "Write a short, personal message that says what you offer and why it helps their readers. Never offer money or free products for a link.", "Track the reply in Link Building Tasks; the task closes when our crawler finds the link."], 20,
                        "/backlinks/opportunities", {"type": "bl_prospect", "domain": g["domain"]}))
    return out


# ------------------------------------------------------------------------------------------------------------------- the automatic, safe action
def group_keywords(db: Session, b: Business) -> dict[str, int]:
    """Give every ungrouped tracked keyword a topic (its most shared main word) and a target page when one page's title and heading already cover it. Only fills blanks."""
    rows = tracked(db, b)
    place = set(core(b.city or ""))
    freq = Counter(w for k in rows for w in set(core(k.keyword)) if w not in place)
    grouped = targeted = 0
    pages = [p for p in (_crawl(db, b).get("pages") or []) if p.get("status") == 200]
    for k in rows:
        c = [w for w in core(k.keyword) if w not in place] or core(k.keyword)
        if not (k.cluster or "").strip() and c:
            specific = [w for w in c if freq[w] <= 0.7 * len(rows)] if len(rows) > 3 else c  # a word that is in nearly every keyword names the whole business, not a topic
            word = max(specific or c, key=lambda w: (freq[w], len(w)))
            shown = next((w for w in _words(k.keyword) if _norm(w) == word), word)  # the word as written ("clothes"), not its stem
            k.cluster = shown.title()
            grouped += 1
        if not (k.target_url or "").strip() and pages:
            cw = core(k.keyword)
            hits = [p["url"] for p in pages if cw and all(w in _corpus([p.get("title"), p.get("h1") if isinstance(p.get("h1"), str) else "", p.get("url")]) for w in cw)]
            if len(hits) == 1:  # only when exactly one page clearly covers it
                k.target_url, targeted = hits[0], targeted + 1
        db.add(k)
    db.flush()
    return {"grouped": grouped, "targeted": targeted}


# ------------------------------------------------------------------------------------------------------------------- verification
def verify(db: Session, b: Business, rule: dict[str, Any], ctx: Any, today: date) -> dict[str, Any]:
    from .growth_plan import _result
    kind = rule["type"]
    rows = tracked(db, b)
    if kind == "kw_count":
        ok = len(rows) >= int(rule["min"])
        return _result(ok, f"{len(rows)} keywords tracked; needs {rule['min']}.", None, len(rows))
    if kind == "competitors_clean":
        from ..competitors import hygiene
        n = len(hygiene.invalid_rows(db, b)) + len(hygiene.invalid_targets(db, b))
        return _result(n == 0, "Every saved competitor is a real competitor website." if n == 0 else f"{n} saved entries are still not competitors' websites.", None, n)
    if kind == "kw_terms":
        left = [t for t in rule["terms"] if not _covered(t, rows)]
        return _result(not left, "Your keywords now use the words your website uses." if not left else f"Still not in any keyword: {', '.join(left)}.", len(rule["terms"]), len(left))
    if kind == "kw_grouped":
        n = sum(1 for k in rows if not (k.cluster or "").strip())
        return _result(n == 0, "Every tracked keyword is in a topic group." if n == 0 else f"{n} keywords still have no topic group.", None, n)
    if kind == "kw_targets":
        n = sum(1 for k in rows if not (k.target_url or "").strip())
        return _result(n == 0, "Every tracked keyword has a target page." if n == 0 else f"{n} keywords still have no target page.", None, n)
    if kind in ("blog_published", "blog_promo"):
        from . import blog_promo
        art = db.get(Article, int(rule["article_id"]))
        if art is None or art.business_id != b.id:
            return _result(None, "The article was deleted.")
        url = blog_promo.published_url(db, art)
        if kind == "blog_published":
            return _result(bool(url), f"The blog is live: {url}" if url else "The blog is not published yet.")
        from ..models import BlogPromotion
        rows = list(db.scalars(select(BlogPromotion).where(BlogPromotion.article_id == art.id)))
        ok_n = sum(1 for r in rows if r.status == "verified")
        need = int(rule.get("min", 3))
        return _result(ok_n >= need, f"{ok_n} of {need} promotion links confirmed." + ("" if ok_n >= need else " Post the overview, paste the address and press Check link."), need, ok_n)
    if kind == "kw_gap":
        have = {k.keyword for k in rows}
        left = [k for k in rule["keywords"] if k not in have]
        return _result(len(left) < len(rule["keywords"]) // 2 + 1 or not left, f"{len(rule['keywords']) - len(left)} of {len(rule['keywords'])} competitor keywords are tracked now." + (f" Still missing: {', '.join(left[:4])}." if left else ""), None, len(left))
    if kind == "comp_reviews":
        have = int(b.review_count or 0)
        return _result(have >= int(rule["target"]), f"{have} reviews; the goal is {rule['target']}." + ("" if have >= int(rule["target"]) else " Reviews update when the Google profile syncs."), None, have)
    if kind == "comp_listings":
        from ..competitors import intel
        from . import keywords as kwsvc
        research = kwsvc.competitor_research(db, b)
        mine = {intel.site_of(x.get("domain", "")) for x in ((research or {}).get("you") or {}).get("link_sources", [])}
        left = [d for d in rule["domains"] if intel.site_of(d) not in mine]
        return _result(len(left) < len(rule["domains"]) and len(left) <= len(rule["domains"]) // 2, f"The latest competitor research finds you on {len(rule['domains']) - len(left)} of {len(rule['domains'])} of these sites." + (" Run the competitor research again after you list." if left else ""), None, len(left))
    if kind == "kw_used":
        report = None
        try:
            from . import growth_metrics
            report = growth_metrics._latest_xray(db, b)[0]
        except Exception:  # noqa: BLE001
            report = None
        text = surfaces_text(db, b, report, _crawl(db, b))[rule["surface"]]
        left = [k for k in rule["keywords"] if not has_keyword(text, k)]
        return _result(not left, "All of these keywords are now used there." if not left else f"Still missing: {', '.join(left[:5])}.", len(rule["keywords"]), len(left))
    if kind == "audit_probe":
        from . import audits
        run = audits.run(db, b, "onpage")
        if getattr(run, "status", "done") != "done":
            return _result(None, "The site crawl did not finish: it will be checked again.")
        left = probes(run.result or {}).get(rule["code"])
        return _result(left is None, "The new crawl no longer shows this problem." if left is None else f"The new crawl still shows it on {len(left['items']) or 'the'} page(s).", None, len(left["items"]) if left else 0)
    if kind == "backlinks":
        from ..backlinks import summary
        bl = summary.own_site_links(db, b.id)
        if bl is None:
            return _result(False, "The website is not tracked in Backlink Intelligence yet.")
        ok = rule.get("field") == "tracked" or bl["referring_domains"] >= int(rule["min"])
        return _result(ok, f"{bl['referring_domains']} referring domains, {bl['backlinks']} links found.", None, bl["referring_domains"])
    if kind == "bl_prospect":
        from ..backlinks import analytics
        from ..backlinks.models import BiTrackedTarget
        mine = next((t.domain for t in db.scalars(select(BiTrackedTarget).where(BiTrackedTarget.business_id == b.id, BiTrackedTarget.is_competitor.is_(False)))), None)
        if not mine:
            return _result(None, "The website is not tracked in Backlink Intelligence.")
        try:
            bounded(db, 20)
            linked = rule["domain"] in analytics.referring_domains(db, mine)
        except Exception:  # noqa: BLE001
            db.rollback()
            return _result(None, "The link data is too slow to read right now: it will be checked again.")
        return _result(linked, f"{rule['domain']} now links to {mine}." if linked else f"Our crawler has not found a link from {rule['domain']} yet. New links can take days to be found.")
    if kind == "articles_since":
        since = datetime.now(timezone.utc) - timedelta(days=int(rule.get("days", 30)))
        n = sum(1 for a in db.scalars(select(Article).where(Article.business_id == b.id, Article.status == "completed")) if _when(a) >= since)
        return _result(n >= int(rule.get("min", 1)), f"{n} article(s) written in the last {rule.get('days', 30)} days.", None, n)
    if kind == "articles_meta":
        n = db.query(Article).filter(Article.business_id == b.id, Article.status == "completed", (Article.meta_description.is_(None)) | (Article.meta_description == "")).count()
        return _result(n == 0, "Every article has a meta description." if n == 0 else f"{n} articles still lack one.", None, n)
    if kind == "competitors_done":
        from . import keywords as kwsvc
        ok = kwsvc.competitor_research(db, b) is not None
        return _result(ok, "Competitor research has finished." if ok else "No finished competitor research yet.")
    return _result(None, "This task has no automatic check.")


# ------------------------------------------------------------------------------------------------------------------- the keyword-to-content plan
def content_plan(db: Session, b: Business) -> dict[str, Any]:
    """Each keyword topic against every place it should be used. Read-only: what exists today, from the real pages, profile, posts and articles."""
    from . import growth_metrics
    rows = tracked(db, b)
    try:
        report = growth_metrics._latest_xray(db, b)[0]
    except Exception:  # noqa: BLE001
        report = None
    text = surfaces_text(db, b, report, _crawl(db, b))
    brand = _brand(b)
    topics: dict[str, list[Keyword]] = {}
    for k in rows:
        if set(core(k.keyword)) <= brand:
            continue
        topics.setdefault((k.cluster or "").strip() or "Ungrouped", []).append(k)
    out = []
    for name, ks in sorted(topics.items(), key=lambda kv: -sum(x.volume or 0 for x in kv[1])):
        cover = {}
        for surface in SURFACES:
            have = [k.keyword for k in ks if has_keyword(text[surface], k.keyword)]
            cover[surface] = {"covered": have, "missing": [k.keyword for k in ks if k.keyword not in have], "done": len(have) == len(ks)}
        out.append({"topic": name, "volume": sum(x.volume or 0 for x in ks), "keywords": [{"keyword": k.keyword, "volume": k.volume, "rank": k.rank, "target_url": k.target_url} for k in ks], "coverage": cover,
                    "complete": all(c["done"] for c in cover.values()), "next": next((s for s, c in cover.items() if not c["done"]), None)})
    return {"topics": out, "surfaces": {k: {"label": v[0].split(" (")[0], "link": v[1]} for k, v in SURFACES.items()}, "tracked": len(rows), "grouped": sum(1 for k in rows if (k.cluster or "").strip())}
