"""Blog publishing platform discovery: websites across the web that publish articles on the business's topics, found with Google searches (the Serper API)
built from this blog's keywords and the business's category and services, not from the competitor list.

For each site found it shows the website, the publishing platform (Medium, Blogger, LinkedIn... or an industry blog), the article title and address, and what was
verified by opening its pages:
- the article: the page opens and reads as an article (article markup, article schema or enough text);
- how it publishes others: a "write for us" / guest-post / submission page found on the site, and whether that page talks about payment (paid) or says it is free;
- the backlink chance: whether its articles link out to other sites with followed links.
Open platforms (Medium, Blogger, WordPress.com...) are marked as such: anyone can publish there from their own account, which is a fact about the platform, not
something read from the page. Anything not seen stays "not verified". Nothing is guessed.

Searches cost quota, and opening two dozen sites is slow, so a run happens in the background and its result is kept for a week per business and topic."""
from __future__ import annotations

import hashlib
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Article, Business, DomainIntelCache
from . import backlink_checker as bc
from . import competitor_blogs as cb

log = logging.getLogger("seo.publish_discovery")
CACHE_TIER = "v1"
SITES_READ = 24
_running: set[tuple[int, str]] = set()
_lock = threading.Lock()

# open platforms: anyone publishes there from their own account
OPEN = {"Medium", "Blogger", "WordPress.com", "Substack", "Tumblr", "DEV Community", "Hashnode", "HubPages", "Vocal", "LinkedIn", "Quora", "Reddit", "EzineArticles", "Issuu", "SlideShare", "Scoop.it", "Flipboard"}
# never a publishing opportunity: search engines, shops, marketplaces, video and listing giants
SKIP = ("google.", "youtube.", "facebook.", "instagram.", "x.com", "twitter.", "amazon.", "flipkart.", "justdial.", "indiamart.", "wikipedia.", "yelp.", "tripadvisor.",
        "apple.com", "microsoft.com", "bing.com", "yahoo.", "pinterest.", "play.google", "glassdoor.", "naukri.", "ambitionbox.", "sulekha.")
GUEST = re.compile(r"write for us|guest (post|author|contributor|blogg?ing|article)s?|submit (a |an |your )?(guest )?(post|article|story|blog)|contribute (an article|to our blog)|become a (contributor|writer|guest author)|contributor guidelines|submission guidelines", re.I)
PAID = re.compile(r"sponsored (post|article|content)s?|paid (guest )?posts?|advertise with us|advertising rates|price (per|for a) (post|article)|(\$|usd|inr|rs\.?|₹)\s?\d{2,}\s*(per|/|for)\s*(a |each )?(post|article)", re.I)
FREE = re.compile(r"free (guest posts?|submissions?|of charge|to submit|publishing)|we (do not|don['’]t) charge|no (fee|charge)s?\b", re.I)
SUBMIT_LINK = re.compile(r"write-?for-?us|guest-?post|contribut|submit-?(an-|your-)?(article|post|guest)|become-a-(writer|contributor)|guidelines|advertis|sponsor", re.I)
SUBMIT_PATHS = ("/write-for-us/", "/guest-post/", "/contribute/")


def _registrable(host: str) -> str:
    host = (host or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "ac", "gov", "edu") and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


# ------------------------------------------------------------------------------------------------------------------------ the searches
def topics_of(b: Business, a: Article | None) -> list[str]:
    """This blog's keyword and secondary keywords first, then the business's category and services: what the searches are about."""
    raw = []
    if a is not None:
        raw += [a.keyword or "", *(a.secondary_keywords or [])[:2]]
    raw += [b.primary_category or "", *[(s.get("name") or "") for s in (b.services or [])[:2]]]
    out: list[str] = []
    for t in raw:
        t = " ".join(t.lower().split())
        if len(t) >= 3 and t not in out:
            out.append(t)
    return out[:4]


def queries(b: Business, a: Article | None) -> list[dict[str, str]]:
    ts = topics_of(b, a)
    if not ts:
        return []
    main, second = ts[0], (ts[1] if len(ts) > 1 else ts[0])
    industry = " ".join((b.primary_category or main).lower().split())
    q = [
        {"q": f"{main} blog", "kind": "Articles on the topic", "topic": main},
        {"q": f'"{main}" article', "kind": "Articles on the topic", "topic": main},
        {"q": f"{second} blog", "kind": "Articles on the topic", "topic": second},
        {"q": f'{industry} "write for us"', "kind": "Guest posts", "topic": industry},
        {"q": f'{main} "guest post"', "kind": "Guest posts", "topic": main},
        {"q": f'{industry} "submit an article" OR "submit a guest post"', "kind": "Guest posts", "topic": industry},
        {"q": f"{main} site:medium.com", "kind": "Open platforms", "topic": main},
        {"q": f"{main} site:linkedin.com/pulse", "kind": "Open platforms", "topic": main},
        {"q": f"{main} site:blogspot.com OR site:wordpress.com", "kind": "Open platforms", "topic": main},
        {"q": f'{industry} "sponsored post" OR "advertise with us" blog', "kind": "Paid publishing", "topic": industry},
    ]
    seen: set[str] = set()
    return [x for x in q if not (x["q"] in seen or seen.add(x["q"]))]


def _search(q: str, country: str) -> list[dict]:
    from ..backlinks import pitch
    return pitch._serper(q, country)


AI_SYSTEM = """You list real, existing websites where a business can publish an article (guest post, contributed article, free submission, sponsored post)
or open platforms where anyone can publish, for the topics given. Only sites you are confident exist and publish articles on these topics; prefer sites read in
the country given. Never invent a domain. Return JSON: {"sites": [{"domain": "example.com", "name": "Example Blog", "page": "https://example.com/write-for-us",
"topic": "one of the topics given"}]} with 10 to 15 sites. "page" is the site's guest-post or submission page if you know it, otherwise its home page."""


def _ai_sites(b: Business, topics: list[str]) -> list[dict[str, Any]]:
    """When the web search cannot run: sites suggested by the AI, to be opened and verified like search results (and labelled as suggestions)."""
    from . import ai
    if not ai.is_configured():
        return []
    out = ai.complete_json(AI_SYSTEM, f"Business: {b.name} ({b.primary_category or ''}), {b.city or ''} {b.country or ''}\nTopics: {topics}", max_tokens=1500)
    sites = []
    for s in (out.get("sites") or []) if isinstance(out, dict) else []:
        try:
            d = str(s["domain"]).lower().strip().removeprefix("https://").removeprefix("http://").removeprefix("www.").split("/")[0]
        except (KeyError, TypeError):
            continue
        if not re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", d):
            continue
        page = str(s.get("page") or "")
        if _registrable(urlsplit(page).hostname or "") != _registrable(d):
            page = f"https://{d}/"
        sites.append({"domain": d, "name": str(s.get("name") or d)[:80], "page": page, "topic": str(s.get("topic") or (topics[0] if topics else ""))[:80]})
    return sites[:15]


# ------------------------------------------------------------------------------------------------------------------------ verifying one site
def _soup(url: str) -> tuple[BeautifulSoup | None, str]:
    status, html_, final, _ms, _err = bc._fetch(url)
    if not html_ or (status or 0) >= 400:
        return None, final or url
    return BeautifulSoup(html_, "html.parser"), final or url


def _is_article_page(soup: BeautifulSoup) -> bool:
    ld = " ".join(s.get_text() for s in soup.find_all("script", type="application/ld+json"))
    if re.search(r'"@type"\s*:\s*"(BlogPosting|Article|NewsArticle|TechArticle)"', ld):
        return True
    main = soup.find("article") or soup.find("main") or soup.body
    return bool(main) and len(re.findall(r"\w+", main.get_text(" ", strip=True))) >= 350


def _links_out(soup: BeautifulSoup, url: str) -> dict[str, int]:
    """External links in the article body: followed and not. A site whose articles link out with followed links can pass a backlink."""
    me = _registrable(urlsplit(url).hostname or "")
    main = soup.find("article") or soup.find("main") or soup.body or soup
    follow = nofollow = 0
    for a in main.find_all("a", href=True):
        full = urljoin(url, a["href"])
        host = _registrable(urlsplit(full).hostname or "")
        if not full.startswith("http") or not host or host == me or cb.platform_of(host):
            continue
        rel = " ".join(a.get("rel") or []).lower()
        if any(x in rel for x in ("nofollow", "sponsored", "ugc")):
            nofollow += 1
        else:
            follow += 1
    return {"follow": follow, "nofollow": nofollow}


def _publishing(soup: BeautifulSoup, url: str) -> dict[str, Any]:
    """Look for the site's own page about publishing others (write for us, guest posts, submissions) and read what it says about payment."""
    pages: list[tuple[str, str]] = []
    link = next((urljoin(url, a["href"]) for a in soup.find_all("a", href=True)
                 if SUBMIT_LINK.search(a["href"]) or GUEST.search(a.get_text(" ", strip=True) or "")), None)
    root = f"{urlsplit(url).scheme}://{urlsplit(url).netloc}"
    tries = ([link] if link and urlsplit(link).netloc == urlsplit(url).netloc else []) + [root + p for p in SUBMIT_PATHS]
    for t in tries[:3]:
        s, final = _soup(t)
        if s is None:
            continue
        text = s.get_text(" ", strip=True)[:20000]
        if GUEST.search(text) or PAID.search(text):
            pages.append((final, text))
            break
    if not pages:
        own = soup.get_text(" ", strip=True)[:20000]
        if GUEST.search(own):
            pages.append((url, own))
    if not pages:
        return {"type": "unknown", "verified": False, "evidence_url": None, "evidence": None}
    page, text = pages[0]
    paid, free, guest = PAID.search(text), FREE.search(text), GUEST.search(text)
    kind = "paid" if paid and not free else "free" if free else "guest" if guest else "paid"
    m = paid if kind == "paid" else free if kind == "free" else guest
    i = m.start() if m else 0
    return {"type": kind, "verified": True, "evidence_url": page, "evidence": " ".join(text[max(0, i - 80): i + 140].split())}


def verify(item: dict[str, Any]) -> dict[str, Any]:
    """Open the article (and, for a site that is not an open platform, its publishing page) and record what was seen."""
    out = dict(item)
    if item["platform"] in OPEN:
        out["publishing"] = {"type": "open", "verified": False, "known": True, "evidence_url": None,
                             "evidence": f"{item['platform']} is an open platform: anyone can publish there from their own account."}
    try:
        soup, final = _soup(item["url"])
    except Exception:  # noqa: BLE001 - one site that cannot be read must not stop the others
        soup, final = None, item["url"]
    out["reachable"] = soup is not None
    out["article_verified"] = bool(soup is not None and _is_article_page(soup))
    out["links_out"] = _links_out(soup, final) if soup is not None else None
    if item["platform"] not in OPEN:
        try:
            out["publishing"] = _publishing(soup, final) if soup is not None else {"type": "unknown", "verified": False, "evidence_url": None, "evidence": None}
        except Exception:  # noqa: BLE001
            out["publishing"] = {"type": "unknown", "verified": False, "evidence_url": None, "evidence": None}
    lo = out["links_out"] or {}
    pub = out["publishing"]
    out["backlink"] = ("likely" if (pub["type"] in ("guest", "free", "open") and (lo.get("follow") or pub["type"] == "open"))
                       else "possible" if pub["type"] in ("guest", "free", "paid", "open") else "unknown")
    return out


# ------------------------------------------------------------------------------------------------------------------------ a run
def _key(b: Business, a: Article | None) -> tuple[str, str]:
    topics = "|".join(topics_of(b, a))
    return f"biz:{b.id}", "pubdisc:" + hashlib.sha1(topics.encode()).hexdigest()[:16]


def cached(db: Session, b: Business, a: Article | None) -> dict[str, Any] | None:
    dom, key = _key(b, a)
    row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == dom, DomainIntelCache.key == key, DomainIntelCache.tier == CACHE_TIER))
    return row.payload if row else None


def is_running(b: Business, a: Article | None) -> bool:
    return (b.id, _key(b, a)[1]) in _running


def start(b: Business, a: Article | None) -> bool:
    k = (b.id, _key(b, a)[1])
    with _lock:
        if k in _running:
            return False
        _running.add(k)
        return True


def run(db: Session, business_id: int, article_id: int | None) -> None:
    """Search, collect the sites, verify each one, and keep the result. Called in the background (start() was called first)."""
    from ..backlinks import hub
    from . import market
    b = db.get(Business, business_id)
    a = db.get(Article, article_id) if article_id else None
    k = (business_id, _key(b, a)[1])
    try:
        own = _registrable(hub.own_domain(db, b.id) or urlsplit(b.website if "://" in (b.website or "") else f"//{b.website or ''}").hostname or "")
        comps = {_registrable(d) for d in hub.hygiene_competitors(db, b)}
        country = market.serp_country(b)
        found: dict[str, dict[str, Any]] = {}
        errors: list[str] = []
        qs = queries(b, a)
        for x in qs:
            try:
                results = _search(x["q"], country)
            except (ValueError, httpx.HTTPError) as exc:
                errors.append(str(exc) if isinstance(exc, ValueError) else "The search service could not be reached.")
                break
            for r in results:
                link = r.get("link") or ""
                host = (urlsplit(link).hostname or "").lower().removeprefix("www.")
                p = cb.platform_of(host)
                reg = _registrable(host)
                if not host or reg == own or (any(s in host for s in SKIP) and not p):
                    continue
                if p and p[0] not in OPEN:
                    continue  # a social profile (Facebook, X...), not a place articles are published
                key = link.split("#")[0] if p else reg  # on an open platform each article is its own result; elsewhere one row per website
                if key in found:
                    if x["kind"] not in found[key]["found_by"]:
                        found[key]["found_by"].append(x["kind"])
                    if x["topic"] not in found[key]["topics"]:
                        found[key]["topics"].append(x["topic"])
                    continue
                found[key] = {"domain": reg if not p else host, "site": (r.get("title") or "").split(" | ")[-1].split(" - ")[-1].strip()[:80] or reg,
                              "platform": p[0] if p else "Website / industry blog", "title": (r.get("title") or "")[:200], "url": link, "snippet": (r.get("snippet") or "")[:240],
                              "found_by": [x["kind"]], "topics": [x["topic"]], "competitor": reg in comps}
        source = "search"
        if not found and (errors or not qs):  # the web search could not run (no key, no credits...): AI suggestions, verified the same way
            try:
                for s in _ai_sites(b, topics_of(b, a)):
                    p = cb.platform_of(s["domain"])
                    reg = _registrable(s["domain"])
                    if reg == own or reg in found or (any(x in s["domain"] for x in SKIP) and not p) or (p and p[0] not in OPEN):
                        continue
                    found[reg] = {"domain": reg, "site": s["name"], "platform": p[0] if p and p[0] in OPEN else "Website / industry blog", "title": s["name"], "url": s["page"],
                                  "snippet": "", "found_by": ["AI suggestion"], "topics": [s["topic"]], "competitor": reg in comps}
                source = "ai" if found else source
            except Exception as exc:  # noqa: BLE001 - the fallback is extra: keep the search error
                log.warning("AI publishing-site suggestions failed: %s", exc)
        ranked = sorted(found.values(), key=lambda i: (-len(i["found_by"]) - len(i["topics"]), i["platform"] in OPEN))[:SITES_READ]
        with ThreadPoolExecutor(max_workers=6) as pool:
            items = list(pool.map(verify, ranked))
        metrics = hub.metrics_for(db, list({_registrable(i["domain"]) for i in items}))
        for i in items:
            m = metrics.get(_registrable(i["domain"])) or {}
            i["da"], i["spam"] = m.get("da"), m.get("spam")
        payload = {"state": "error" if errors and not items else "ok", "message": errors[0] if errors else "", "source": source, "searched": 0 if source == "ai" else len(qs), "queries": [x["q"] for x in qs],
                   "topics": topics_of(b, a), "items": items, "checked_at": datetime.now(timezone.utc).isoformat()}
        dom, ckey = _key(b, a)
        row = db.scalar(select(DomainIntelCache).where(DomainIntelCache.domain == dom, DomainIntelCache.key == ckey, DomainIntelCache.tier == CACHE_TIER))
        if row is None:
            row = DomainIntelCache(domain=dom, key=ckey, tier=CACHE_TIER)
            db.add(row)
        row.payload, row.fetched_at = payload, datetime.now(timezone.utc)
        db.commit()
    finally:
        with _lock:
            _running.discard(k)


def view(db: Session, b: Business, a: Article | None) -> dict[str, Any]:
    from ..backlinks.models import BiOpportunity
    from ..config import get_settings
    from . import ai
    if not get_settings().serper_api_key.strip() and not ai.is_configured():
        return {"state": "no_search", "running": False, "items": [], "message": "Web discovery needs the search key: add SERPER_API_KEY to the backend settings."}
    if not topics_of(b, a):
        return {"state": "no_topic", "running": False, "items": [], "message": "Add the blog's keyword or the business's category to search for publishing sites."}
    data = cached(db, b, a)
    saved = {r.domain: r.status for r in db.scalars(select(BiOpportunity).where(BiOpportunity.business_id == b.id))}
    out = dict(data) if data else {"state": "not_run", "items": [], "topics": topics_of(b, a)}
    out["items"] = [{**i, "saved": saved.get(i["domain"])} for i in out.get("items", [])]
    out["running"] = is_running(b, a)
    return out


def save(db: Session, b: Business, a: Article | None, domain: str) -> None:
    """Keep a discovered site in the business's link-building plan (Backlinks > Link Opportunities / Outreach), with what was found about it."""
    from ..backlinks.models import BiOpportunity
    from ..db import utcnow
    data = cached(db, b, a) or {}
    item = next((i for i in data.get("items", []) if i["domain"] == domain), None)
    if not item:
        raise ValueError("That site is not among the discovered sites.")
    row = db.scalar(select(BiOpportunity).where(BiOpportunity.business_id == b.id, BiOpportunity.domain == domain))
    if row is None:
        pub = item["publishing"]
        note = f"{item['platform']} · {pub['type']}{' (verified)' if pub.get('verified') else ''} · {item['url']}"
        row = BiOpportunity(business_id=b.id, domain=domain, source="discovery", status="planned", name=(item.get("site") or domain)[:160], note=note[:500], status_at=utcnow())
        db.add(row)
        db.commit()
