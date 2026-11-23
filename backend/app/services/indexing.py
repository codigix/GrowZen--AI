"""Page indexing for a project's site.

What this can and cannot do, so nothing here promises more than it delivers:
  * Find the site's pages from its sitemap, and notice new and changed ones (the sitemap's lastmod).
  * Send them to the search engines that accept submissions, through IndexNow (Bing, Yandex, Seznam, Naver, Yep and others). Google does not take part in IndexNow.
  * Read Google's own verdict for each page through the URL Inspection API (indexed or not, why, last crawl, the canonical Google chose), for sites verified in the
    connected Search Console account. Google offers no public way to ask for a page to be indexed (the Indexing API is for job-posting and livestream pages only),
    so for Google the work is a clean sitemap, a status for every page, and a plain reason with a fix for each page that is not indexed.
"""
import logging
import re
import secrets
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Business, IndexPage, IndexSetting, IndexStatDay
from . import backlink_checker as bc
from . import sitemap
from .activity import log

logger = logging.getLogger("seo.indexing")
INDEXNOW = "https://api.indexnow.org/IndexNow"
ENGINES = ["Bing", "Yandex", "Seznam", "Naver", "Yep"]  # the engines IndexNow passes a submission on to
MAX_PAGES = 1000
SUBMIT_BATCH = 200
INSPECT_BATCH = 25  # per run: Google allows about 2,000 inspections a day per property, this keeps a day's runs far below that


class IndexingError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def host_of(b: Business) -> str:
    from . import gsc
    return gsc.host_of(b.website)


def setting(db: Session, b: Business) -> IndexSetting:
    row = db.scalar(select(IndexSetting).where(IndexSetting.business_id == b.id))
    if row is None:
        row = IndexSetting(business_id=b.id, auto=False)
        db.add(row)
        db.flush()
    return row


# ------------------------------------------------------------------------------------------------------------------------ the IndexNow key
def ensure_key(db: Session, b: Business) -> IndexSetting:
    st = setting(db, b)
    if not st.indexnow_key:
        st.indexnow_key = secrets.token_hex(16)  # 32 characters, letters and digits, as IndexNow asks
        st.key_verified_at = None
        db.flush()
    return st


def key_location(b: Business, key: str) -> str:
    return f"https://{host_of(b)}/{key}.txt"


def _read_key_file(url: str) -> tuple[int | None, str, str | None]:
    """(status, text, error) of the key file. It is plain text, so it is read as text: the page fetcher used elsewhere only accepts HTML."""
    from .net import site_client
    client = site_client(10)
    try:
        r = client.get(url)
        return r.status_code, r.text[:2000], None
    except Exception as exc:  # noqa: BLE001
        return None, "", str(exc)[:100]
    finally:
        client.close()


def verify_key(db: Session, b: Business) -> tuple[bool, str]:
    """Whether the key file is on the site where IndexNow will look for it. It proves the site is ours, so the search engines accept the submissions."""
    st = ensure_key(db, b)
    url = key_location(b, st.indexnow_key)
    status, body, error = _read_key_file(url)
    if error or status != 200:
        st.key_verified_at = None
        db.commit()
        return False, f"The key file is not on your site yet: {url} {'answered ' + str(status) if status else 'could not be opened'}. Upload the file to the root of the site and try again."
    if body.lstrip("\ufeff").strip() != st.indexnow_key:
        st.key_verified_at = None
        db.commit()
        shown = body.strip()[:60].replace("\n", " ")
        why = "it looks like a web page (the site answers every address with its home page), not the file" if body.lstrip().startswith("<") else f"it contains \"{shown}\""
        return False, f"{url} opens, but its text is not the key: {why}. The file must contain only the key."
    st.key_verified_at = _now()
    db.commit()
    return True, "The key file is in place: new pages can be sent to the search engines."


# ------------------------------------------------------------------------------------------------------------------------ finding the pages
def scan(db: Session, b: Business, max_pages: int = MAX_PAGES) -> dict[str, Any]:
    """Read the sitemap, add the pages not seen before, notice the ones whose lastmod moved, and mark what Google already shows in search."""
    if not b.website:
        raise IndexingError("Add the project's website first.")
    try:
        entries = sitemap.discover_site_entries(b.website, max_pages)
    except sitemap.SitemapDiscoveryError as exc:
        raise IndexingError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise IndexingError("The site's sitemap could not be read right now.") from exc
    now = _now()
    have = {p.url: p for p in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id))}
    new = changed = 0
    live = set()
    for url, mod in entries:
        url = url[:1000]
        live.add(url)
        row = have.get(url)
        if row is None:
            db.add(IndexPage(business_id=b.id, url=url, source="sitemap", in_sitemap=True, first_seen_at=now, last_seen_at=now, lastmod=mod))
            new += 1
            continue
        row.in_sitemap, row.last_seen_at = True, now
        if mod and row.lastmod and mod != row.lastmod:
            row.changed_at = now
            row.skip_reason = None  # it changed: look at it again
            changed += 1
        if mod:
            row.lastmod = mod
    for url, row in have.items():
        if url not in live and row.source == "sitemap":
            row.in_sitemap = False
    db.flush()
    seen = google_seen(db, b)
    st = setting(db, b)
    st.last_scan_at = now
    st.last_scan = {**(st.last_scan or {}), "found": len(entries), "new": new, "changed": changed, "seen_in_google": seen}
    db.commit()
    return {"found": len(entries), "new": new, "changed": changed, "seen_in_google": seen}


def google_seen(db: Session, b: Business) -> int:
    """Pages that had impressions in Google Search in the last 28 days are indexed, whatever else is known: mark them without spending an inspection."""
    from . import gsc, gsc_access, market
    host = host_of(b)
    if not host:
        return 0
    try:
        state, _msg, sc, site = gsc_access.search_console(db, b, host)
        if state != "ok":
            return 0
        rep = gsc.report(sc, site, "28d", market.serp_country(b))
    except Exception:  # noqa: BLE001
        return 0
    pages = {p["page"]: p for p in rep.get("pages", [])}
    if not pages:
        return 0
    n = 0
    for row in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url.in_(list(pages)))):
        if row.g_state != "indexed":
            row.g_state, row.g_reason, row.g_checked_at = "indexed", "Shows in Google Search (it had impressions in the last 28 days).", _now()
            n += 1
    return n


def pending(db: Session, b: Business) -> list[IndexPage]:
    """Pages to send: never sent, or changed since they were sent. Pages that were found unfit (noindex, an error) wait until they change."""
    out = []
    for p in db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.in_sitemap.is_(True)).order_by(IndexPage.first_seen_at.desc())):
        if p.skip_reason:
            continue
        sent, ch = _aware(p.submitted_at), _aware(p.changed_at)
        if sent is None or (ch and ch > sent):
            out.append(p)
    return out


# ------------------------------------------------------------------------------------------------------------------------ can the page be indexed at all (our own check: needs no Google account)
TECH_EVERY = timedelta(days=3)
TECH_BATCH = 40


def _same_page(a: str, b: str) -> bool:
    """Two addresses of the same page: scheme, www and a trailing slash do not make a different page."""
    def norm(u: str) -> str:
        p = urlsplit(u)
        return f"{(p.hostname or '').lower().removeprefix('www.')}{(p.path or '/').rstrip('/') or '/'}?{p.query}"
    return norm(a) == norm(b)


def _robots_for(url: str):
    """The site's robots.txt as Googlebot reads it (None when it cannot be read: then nothing is blocked by it)."""
    from urllib.robotparser import RobotFileParser
    from .net import site_client
    p = urlsplit(url)
    client = site_client(8)
    try:
        r = client.get(f"{p.scheme}://{p.netloc}/robots.txt")
        if r.status_code >= 400:
            return None
        rp = RobotFileParser()
        rp.parse(r.text.splitlines())
        return rp
    except Exception:  # noqa: BLE001
        return None
    finally:
        client.close()


def check_page(url: str, robots=None) -> dict[str, Any]:
    """Can Google index this page? Loads it the way a crawler does and looks for what stops indexing: an error, a redirect, a noindex tag or header, robots.txt, a canonical pointing
    elsewhere, or no readable text without JavaScript. Says nothing about whether Google HAS indexed it: only Search Console can answer that."""
    from bs4 import BeautifulSoup
    from .net import site_client
    reasons: list[dict[str, str]] = []
    out: dict[str, Any] = {"status": None, "words": None, "canonical": None}
    client = site_client(12)
    try:
        r = client.get(url)
    except Exception as exc:  # noqa: BLE001
        return out | {"verdict": "blocked", "reasons": [{"level": "blocked", "text": f"The page could not be loaded ({str(exc)[:80]}). Google cannot index a page it cannot reach."}]}
    finally:
        client.close()
    out["status"] = r.status_code
    if r.status_code >= 400:
        reasons.append({"level": "blocked", "text": f"The page answers HTTP {r.status_code}, so Google will not index it."})
    final = str(r.url)
    if not _same_page(url, final):
        reasons.append({"level": "risky", "text": f"It redirects to {final[:120]}. Google indexes the page it ends on, not this address."})
    header = (r.headers.get("x-robots-tag") or "").lower()
    if "noindex" in header:
        reasons.append({"level": "blocked", "text": "The server sends a noindex header (X-Robots-Tag), so Google will not index it."})
    if robots is not None:
        try:
            if not robots.can_fetch("Googlebot", url):
                reasons.append({"level": "blocked", "text": "robots.txt does not let Googlebot read this page."})
        except Exception:  # noqa: BLE001
            pass
    if r.status_code < 400 and "html" in (r.headers.get("content-type") or "").lower():
        soup = BeautifulSoup(r.text, "html.parser")
        meta = soup.find("meta", attrs={"name": re.compile("^(robots|googlebot)$", re.I)})
        if meta and "noindex" in (meta.get("content") or "").lower():
            reasons.append({"level": "blocked", "text": "The page has a noindex tag, so Google will not index it."})
        canon = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
        href = (canon.get("href") or "").strip() if canon else ""
        if href:
            href = urljoin(final, href)
            out["canonical"] = href[:300]
            if not _same_page(href, final):
                reasons.append({"level": "risky", "text": f"Its canonical tag points to {href[:120]}: Google will index that page instead of this one."})
        for t in soup(["script", "style", "noscript", "nav", "footer", "header"]):
            t.decompose()
        words = len(soup.get_text(" ", strip=True).split())
        out["words"] = words
        if words < 40:
            reasons.append({"level": "risky", "text": f"Only {words} words of text are readable without JavaScript. If the content is drawn by JavaScript, Google may index an almost empty page."})
    verdict = "blocked" if any(x["level"] == "blocked" for x in reasons) else "risky" if reasons else "indexable"
    return out | {"verdict": verdict, "reasons": reasons}


def check_pages(db: Session, b: Business, urls: list[str] | None = None, limit: int = TECH_BATCH, force: bool = False) -> dict[str, Any]:
    """Run the check on the pages never checked, changed since, or last checked over 3 days ago (or the given addresses). Returns the counts by verdict."""
    now = _now()
    rows = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id)))
    if urls is not None:
        want = set(urls)
        todo = [p for p in rows if p.url in want]
    else:
        todo = [p for p in rows if force or p.tech is None or (p.tech_at and _aware(p.tech_at) < now - TECH_EVERY) or (p.changed_at and p.tech_at and _aware(p.changed_at) > _aware(p.tech_at))]
    todo = todo[: max(1, limit)]
    if not todo:
        return {"checked": 0, "indexable": 0, "risky": 0, "blocked": 0}
    robots = _robots_for(todo[0].url)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda p: check_page(p.url, robots), todo))
    counts = {"indexable": 0, "risky": 0, "blocked": 0}
    for p, res in zip(todo, results):
        p.tech, p.tech_at = res, now
        counts[res["verdict"]] += 1
    db.commit()
    return {"checked": len(todo), **counts}


# ------------------------------------------------------------------------------------------------------------------------ sending to the other search engines
_NOINDEX = [re.compile(r"<meta[^>]+name=[\"']robots[\"'][^>]*content=[\"'][^\"']*noindex", re.I), re.compile(r"<meta[^>]+content=[\"'][^\"']*noindex[^\"']*[\"'][^>]*name=[\"']robots[\"']", re.I)]


def probe(url: str) -> str | None:
    """None when the page is fit to send, else why not: sending a page that errors or says noindex only teaches the engines to ignore the site."""
    status, html, _final, _ms, error = bc._fetch(url)
    if error:
        return error[:150]
    if status and status >= 400:
        return f"The page answers HTTP {status}"
    if any(rx.search(html[:60000]) for rx in _NOINDEX):
        return "The page is marked noindex"
    return None


def indexnow(host: str, key: str, location: str, urls: list[str]) -> tuple[bool, int, str]:
    """(accepted, status, message). 200 and 202 mean the engines received the list."""
    try:
        r = httpx.post(INDEXNOW, json={"host": host, "key": key, "keyLocation": location, "urlList": urls[:10000]}, headers={"Content-Type": "application/json; charset=utf-8"}, timeout=25)
    except httpx.HTTPError:
        return False, 0, "IndexNow could not be reached. It will be tried again."
    msg = {200: "Accepted.", 202: "Accepted: the key will be checked.", 400: "IndexNow rejected the request format.", 403: "The key could not be found on your site: check the key file.",
           422: "IndexNow says some addresses do not belong to this site.", 429: "Too many submissions: wait a while."}.get(r.status_code, f"IndexNow answered {r.status_code}.")
    return r.status_code in (200, 202), r.status_code, msg


def submit(db: Session, b: Business, urls: list[str] | None = None, limit: int = SUBMIT_BATCH) -> dict[str, Any]:
    """Send new and changed pages (or the chosen ones) to IndexNow. Pages that are not fit are skipped with the reason."""
    st = ensure_key(db, b)
    if not st.key_verified_at:
        raise IndexingError("Put the key file on your site first (and press Check): the search engines accept pages only from a site that shows the key.")
    if urls:
        rows = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url.in_(urls))))
    else:
        rows = pending(db, b)
    rows = rows[:limit]
    if not rows:
        return {"sent": 0, "skipped": [], "message": "Nothing new to send.", "engines": ENGINES}
    with ThreadPoolExecutor(max_workers=8) as pool:
        verdicts = list(pool.map(lambda r: probe(r.url), rows))
    fit, skipped = [], []
    for row, why in zip(rows, verdicts):
        if why:
            row.skip_reason = why
            skipped.append({"url": row.url, "reason": why})
        else:
            fit.append(row)
    ok, code, msg = True, 200, "Nothing fit to send."
    if fit:
        ok, code, msg = indexnow(host_of(b), st.indexnow_key, key_location(b, st.indexnow_key), [r.url for r in fit])
        if ok:
            now = _now()
            for r in fit:
                r.submitted_at, r.submitted_to = now, ENGINES
    db.commit()
    return {"sent": len(fit) if ok else 0, "skipped": skipped, "message": msg, "status": code, "engines": ENGINES, "ok": ok}


# ------------------------------------------------------------------------------------------------------------------------ what Google says
ADVICE = {
    "crawled - currently not indexed": "Google saw the page and chose not to index it yet. Make the page clearly useful and different from others on the site, then link to it from your main pages.",
    "discovered - currently not indexed": "Google knows the address but has not visited it. Link to it from your home page or a main service page, and keep it in the sitemap.",
    "duplicate without user-selected canonical": "Google thinks this page repeats another. Set a canonical tag pointing to the version you want indexed, or make the content different.",
    "duplicate, google chose different canonical than user": "Google picked another address as the main version. Check which one you want, and make the canonical tags and internal links agree.",
    "alternate page with proper canonical tag": "This page points to another as its main version, so only that one is indexed. That is normal unless it is the wrong way round.",
    "page with redirect": "The address redirects elsewhere. Only the destination is indexed, so link to and list the destination.",
    "not found (404)": "The page does not exist. Remove it from the sitemap and from internal links, or restore it.",
    "soft 404": "The page looks empty or like an error to Google. Add real content, or return a proper 404 if it should not exist.",
    "blocked by robots.txt": "robots.txt stops Google visiting this page. Remove the rule if it should be indexed.",
    "excluded by 'noindex' tag": "A noindex tag keeps it out of Google. Remove the tag if the page should appear.",
    "url is unknown to google": "Google has never seen this address. Add it to the sitemap and link to it from another page.",
}


def advice(reason: str | None) -> str | None:
    low = (reason or "").lower().strip()
    return next((v for k, v in ADVICE.items() if k in low), None)


def parse_inspection(js: dict[str, Any]) -> dict[str, Any]:
    r = (js.get("inspectionResult") or {}).get("indexStatusResult") or {}
    cov, verdict = r.get("coverageState") or "", r.get("verdict")
    robots, idx = r.get("robotsTxtState"), r.get("indexingState") or ""
    if verdict == "PASS":
        state = "indexed"
    elif robots == "DISALLOWED" or idx.startswith("BLOCKED"):
        state = "blocked"
    elif verdict in ("FAIL", "NEUTRAL") or "not indexed" in cov.lower() or "excluded" in cov.lower():
        state = "not_indexed"
    else:
        state = "unknown"
    crawl = r.get("lastCrawlTime")
    try:
        crawled = datetime.fromisoformat(crawl.replace("Z", "+00:00")) if crawl else None
    except ValueError:
        crawled = None
    return {"state": state, "reason": cov[:250] or None, "last_crawl": crawled, "canonical": (r.get("googleCanonical") or None), "link": ((js.get("inspectionResult") or {}).get("inspectionResultLink") or None)}


def parse_detail(js: dict[str, Any]) -> dict[str, Any]:
    """Everything the URL Inspection API says about one page, in the order Search Console shows it: the verdict, the page's availability, and the enhancements (mobile, rich results)."""
    res = js.get("inspectionResult") or {}
    r = res.get("indexStatusResult") or {}
    mob = res.get("mobileUsabilityResult") or {}
    rich = res.get("richResultsResult") or {}
    base = parse_inspection(js)
    verdict = r.get("verdict")
    return {
        "state": base["state"], "verdict": verdict, "coverage": r.get("coverageState"), "advice": advice(r.get("coverageState")), "link": base["link"],
        "robots": r.get("robotsTxtState"), "indexing": r.get("indexingState"), "fetch": r.get("pageFetchState"), "crawled_as": r.get("crawledAs"),
        "last_crawl": r.get("lastCrawlTime"), "google_canonical": r.get("googleCanonical"), "user_canonical": r.get("userCanonical"),
        "sitemaps": list(r.get("sitemap") or [])[:10], "referring": list(r.get("referringUrls") or [])[:10],
        "mobile": {"verdict": mob.get("verdict"), "issues": [{"type": i.get("issueType"), "severity": i.get("severity"), "message": i.get("message")} for i in mob.get("issues") or []]} if mob else None,
        "rich": {"verdict": rich.get("verdict"), "items": [{"type": d.get("richResultType"), "items": [{"name": it.get("name"), "issues": [{"message": x.get("issueMessage"), "severity": x.get("severity")} for x in it.get("issues") or []]} for it in d.get("items") or []]} for d in rich.get("detectedItems") or []]} if rich else None,
    }


def live_test(url: str) -> dict[str, Any]:
    """Load the page right now, the way a crawler would, and report what came back: status, redirects, headers that matter, the tags Google reads and the HTML itself.
    This is OUR fetch, not Google's: Google's own live test is only available inside Search Console and is not offered through its API."""
    import time as _time

    from bs4 import BeautifulSoup

    from .net import site_client
    client = site_client(15)
    t0 = _time.time()
    try:
        r = client.get(url)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"The page could not be loaded: {str(exc)[:160]}", "check": check_page(url)}
    finally:
        client.close()
    html = r.text if "html" in (r.headers.get("content-type") or "").lower() else ""
    soup = BeautifulSoup(html, "html.parser") if html else None

    def meta(name: str) -> str | None:
        m = soup.find("meta", attrs={"name": re.compile(f"^{name}$", re.I)}) if soup else None
        return (m.get("content") or "").strip() if m else None

    og = {}
    if soup:
        for m in soup.find_all("meta", attrs={"property": re.compile(r"^og:", re.I)}):
            og[(m.get("property") or "")[3:]] = (m.get("content") or "")[:200]
    chain = [str(h.url) for h in r.history] + [str(r.url)]
    return {
        "ok": True, "status": r.status_code, "final_url": str(r.url), "redirects": chain if len(chain) > 1 else [], "ms": int((_time.time() - t0) * 1000), "bytes": len(r.content),
        "content_type": r.headers.get("content-type"), "x_robots": r.headers.get("x-robots-tag"), "server": r.headers.get("server"), "tested_at": _now().isoformat(),
        "title": (soup.title.string.strip() if soup and soup.title and soup.title.string else None), "description": meta("description"), "robots_meta": meta("robots") or meta("googlebot"),
        "canonical": next((urljoin(str(r.url), (l.get("href") or "")) for l in (soup.find_all("link") if soup else []) if "canonical" in (l.get("rel") or [])), None),
        "h1": [h.get_text(" ", strip=True)[:140] for h in (soup.find_all("h1") if soup else [])][:3], "lang": (soup.html.get("lang") if soup and soup.html else None),
        "og": og, "schema_types": sorted({str(x)[:40] for s in (soup.find_all("script", type="application/ld+json") if soup else []) for x in re.findall(r'"@type"\s*:\s*"([^"]+)"', s.string or "")})[:12],
        "html": html[:60000], "html_truncated": len(html) > 60000, "check": check_page(url),
    }


def _home_head(url: str) -> dict[str, Any]:
    """The home page's title, description and canonical: a page that repeats them is, to Google, the home page again."""
    from bs4 import BeautifulSoup

    from .net import site_client
    p = urlsplit(url)
    home = f"{p.scheme}://{p.netloc}/"
    if _same_page(url, home):
        return {}
    client = site_client(10)
    try:
        r = client.get(home)
        soup = BeautifulSoup(r.text, "html.parser")
        m = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
        return {"title": (soup.title.string or "").strip() if soup.title and soup.title.string else None, "description": (m.get("content") or "").strip() if m else None}
    except Exception:  # noqa: BLE001
        return {}
    finally:
        client.close()


def _step(*lines: str) -> list[str]:
    return [x for x in lines if x]


def diagnose(url: str, google: dict[str, Any] | None, live: dict[str, Any], home: dict[str, Any], in_sitemap: bool | None = None, stack: str | None = None) -> dict[str, Any]:
    """Why the page is not (or may not be) in Google, in plain words, with the evidence for each cause and the exact fix. Causes are ordered: what stops indexing first, then what makes Google
    skip a page it can read. Each is {level: blocker | cause | warning, title, evidence, why, fix: [steps]}."""
    items: list[dict[str, Any]] = []

    def add(level: str, title: str, evidence: str, why: str, fix: list[str]) -> None:
        items.append({"level": level, "title": title, "evidence": evidence, "why": why, "fix": fix})

    g = google or {}
    cov = (g.get("coverage") or "").strip()
    low = cov.lower()
    ok = bool(live.get("ok"))
    status = live.get("status")
    check = live.get("check") or {}
    words = check.get("words")
    canon = live.get("canonical")
    page_canon_other = bool(canon) and not _same_page(canon, url)
    head_same = bool(home) and bool(live.get("title")) and live.get("title") == home.get("title")
    desc_same = bool(home) and bool(live.get("description")) and live.get("description") == home.get("description")
    shell = ok and words is not None and words < 40
    spa = ok and bool(re.search(r'id=["\'](root|app|__next|__nuxt)["\']', live.get("html") or "")) or shell
    framework = "React" if "react" in (stack or "").lower() else (stack or "")

    if not ok:
        add("blocker", "The page cannot be loaded", live.get("error") or "No answer from the server.", "Google cannot index a page it cannot open.",
            _step("Open the address in a browser: if it fails, the server or the address is wrong.", "Check the hosting, DNS and SSL certificate of the site.", "Then press Test again."))
    elif status and status >= 500:
        add("blocker", f"The server answers with an error (HTTP {status})", f"HTTP {status}", "Google retries later, but a page that keeps failing is dropped from the index.",
            _step("Open the server error log for this address and fix the error.", "Make the page answer HTTP 200."))
    elif status and status >= 400:
        add("blocker", f"The page does not exist (HTTP {status})", f"HTTP {status}", "Google does not index pages that answer an error.",
            _step("If the page should exist: restore it, or fix the link or sitemap entry that points here.", "If it was removed on purpose: take it out of the sitemap and the internal links."))
    if ok and live.get("redirects"):
        add("blocker", "The address redirects to another page", f"{url} → {live.get('final_url')}", "Google indexes the page the redirect ends on, not this address.",
            _step(f"Use {live.get('final_url')} in your sitemap and internal links instead of this address.", "If the redirect is a mistake, remove it."))
    robots_blocked = g.get("robots") == "DISALLOWED" or any("robots.txt" in (r.get("text") or "") for r in check.get("reasons") or [])
    if robots_blocked or "blocked by robots" in low:
        add("blocker", "robots.txt stops Google from reading the page", "robots.txt disallows Googlebot for this address.", "Google may list the address but cannot read it.",
            _step("Open /robots.txt on the site and find the Disallow line that matches this path.", "Remove or narrow that rule.", "Test it with Search Console's robots.txt report."))
    noindex_header = bool(live.get("x_robots")) and "noindex" in str(live.get("x_robots")).lower()
    noindex_meta = bool(live.get("robots_meta")) and "noindex" in str(live.get("robots_meta")).lower()
    if noindex_header or noindex_meta or "noindex" in low:
        where = "the X-Robots-Tag header" if noindex_header else "the robots meta tag" if noindex_meta else "the page"
        add("blocker", "A noindex instruction keeps the page out of Google", f"noindex found in {where}.", "Google obeys noindex: the page is never listed while it is there.",
            _step("Remove the noindex from the robots meta tag" + (" and from the server's X-Robots-Tag header" if noindex_header else "") + ".", "Then request indexing in Search Console."))
    if ok and page_canon_other:
        to_home = _same_page(canon, urlsplit(url).scheme + "://" + urlsplit(url).netloc + "/")
        add("cause", "The page tells Google it is a copy of another page" + (" (the home page)" if to_home else ""), f"The canonical tag on this page is {canon}, not {url}.",
            "A canonical to another address means \"index that page, not this one\". Google follows it, so this address is left out as a duplicate.",
            _step(f'Change the canonical tag of this page to point to itself: <link rel="canonical" href="{url}">.',
                  "On a React or JavaScript site the tag is often one fixed tag in index.html: set the canonical per page (React Helmet, Next.js metadata, or your CMS's SEO field)." if spa else "Set the canonical in the page's SEO field of your CMS or template.",
                  "Check it with Page indexing > Details > Live test (the Canonical tag line)."))
    if shell:
        add("cause", "The page has almost no text for Google to read", f"Only {words} words are in the page as the server sends it (before JavaScript runs).",
            "Google may render JavaScript, but it often indexes a page late or not at all when the content is drawn only by scripts, and \"Crawled - currently not indexed\" is the usual result.",
            _step(f"Make the server send the real content in the HTML: server-side rendering or pre-rendering ({framework or 'your framework'}'s SSR/static export, or a pre-render service).",
                  "Or publish the post as a static HTML page with its text, heading and images in the page itself.", "After the change, Test again: the word count here should be in the hundreds."))
    elif ok and words is not None and words < 150 and "currently not indexed" in low:
        add("cause", "The page has very little content", f"About {words} words are readable.", "Google skips pages it sees as thin, with little that is not already on the site.",
            _step("Add useful, original content: answer the questions a customer would ask, add details, images with captions and internal links.", "Aim for what the page needs to be complete, not a word count."))
    if ok and (head_same or desc_same):
        same = "title and meta description" if head_same and desc_same else "title" if head_same else "meta description"
        add("cause", f"The page repeats the home page's {same}", f"Title: \"{(live.get('title') or '')[:80]}\"" + (" (same as the home page)" if head_same else ""),
            "Pages with the same title and description look like duplicates of each other, so Google keeps one and drops the rest.",
            _step("Write a title (50 to 60 characters) and a description (130 to 155) that describe THIS page and its topic.",
                  "On a single-page app, set them per route: the home page's tags are being served for every address." if spa else ""))
    if "duplicate" in low or "alternate page" in low:
        add("cause", "Google treats the page as a duplicate", cov, "Google picks one version of duplicate pages and does not index the others.",
            _step("Decide which address is the real one and use it in the canonical tag, the sitemap and internal links.", "Make the duplicate redirect (301) to it, or give it its own content."))
    if "soft 404" in low:
        add("cause", "Google thinks the page is an error page", cov, "The page loads but looks empty or like \"not found\" to Google.", _step("Add the real content, or answer with a proper 404 if the page should not exist."))
    if "discovered - currently not indexed" in low:
        add("cause", "Google knows the page but has not read it yet", cov, "Google queues new pages and reaches them when it has time; weak internal links slow this down.",
            _step("Link to this page from your home page and from related pages.", "Make sure it is in the sitemap.", "Request indexing in Search Console (Open in Search Console above)."))
    if "unknown to google" in low:
        add("cause", "Google has never seen this address", cov, "No link or sitemap has led Google here yet.", _step("Add it to the sitemap and link to it from another page.", "Request indexing in Search Console."))
    if in_sitemap is False or (google and not g.get("sitemaps") and in_sitemap is not True):
        add("warning", "Google has no sitemap that lists this page", "The inspection reports no sitemap containing the address.", "A sitemap tells Google the page exists and when it changed.",
            _step("Add the page to your sitemap.xml and submit the sitemap in Search Console (Sitemaps)."))
    if google and not g.get("referring"):
        add("warning", "Google found no links to this page", "No referring page was reported.", "Pages nothing links to look unimportant and are crawled less.",
            _step("Link to this page from the home page, the blog index and two or three related pages."))
    if ok and not live.get("h1"):
        add("warning", "The page has no main heading (H1)", "No H1 in the page as sent by the server.", "A clear heading helps Google understand the topic.", _step("Add one H1 with the page's main topic."))
    if ok and not live.get("schema_types"):
        add("warning", "No structured data", "No schema.org markup found.", "Structured data helps Google show richer results. It does not decide indexing.", _step("For a blog post add Article or BlogPosting markup (JSON-LD)."))

    if not items and (g.get("state") == "indexed"):
        headline = "Nothing is wrong: this page is in Google."
    elif not items:
        headline = "No technical problem was found. Google has simply not indexed the page yet."
        add("warning", "Wait and request indexing", cov or "Google gave no reason.", "New pages can take days to weeks.", _step("Request indexing in Search Console (Open in Search Console above).", "Keep the page in the sitemap and link to it from other pages."))
    else:
        n = sum(1 for i in items if i["level"] in ("blocker", "cause"))
        if g.get("state") == "indexed":
            headline = f"The page is in Google (\"{cov}\"), but {n} thing{'s' if n != 1 else ''} put it at risk of dropping out or hold it back." if n else "The page is in Google. Only small improvements found."
        else:
            headline = f"{n} problem{'s' if n != 1 else ''} found" + (f": Google says \"{cov}\"." if cov else ".") if n else "Only small improvements found."
    return {"headline": headline, "reason_google": cov or None, "items": items}


def page_detail(db: Session, b: Business, url: str) -> dict[str, Any]:
    """The page's two views: what Google holds for it (URL Inspection API) and a fresh test of the page itself. Google's side is saved on the page's row too."""
    from . import gsc_access
    host = host_of(b)
    if not host:
        raise IndexingError("Add the project's website first.")
    if (urlsplit(url).hostname or "").lower().removeprefix("www.") != host.lower().removeprefix("www."):
        raise IndexingError("That address is not on this project's website.")
    pool = ThreadPoolExecutor(max_workers=2)  # the page test and the home page read run while Google answers: the panel opens in the time of the slowest, not the sum
    live_f, home_f = pool.submit(live_test, url), pool.submit(_home_head, url)
    google, gerr = None, None
    state, msg, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        gerr = msg
    else:
        try:
            google = parse_detail(sc.inspect(site, url))
            row = db.scalar(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url == url))
            if row is not None:
                crawl = google["last_crawl"]
                try:
                    row.g_last_crawl = datetime.fromisoformat(crawl.replace("Z", "+00:00")) if crawl else row.g_last_crawl
                except ValueError:
                    pass
                row.g_state, row.g_reason, row.g_canonical, row.g_checked_at = google["state"], (google["coverage"] or "")[:250] or None, google["google_canonical"], _now()
                row.g_link = google["link"] or row.g_link
                db.commit()
        except Exception as exc:  # noqa: BLE001 - Google's reason (quota, permission)
            gerr = str(exc)[:240]
    live, home = live_f.result(), home_f.result()
    pool.shutdown(wait=False)
    row = db.scalar(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url == url))
    try:
        from . import site_research
        stack = ((site_research.get(db, b).stack or {}).get("name") or (site_research.get(db, b).stack or {}).get("framework") or "") if site_research.get(db, b) else ""
    except Exception:  # noqa: BLE001
        stack = ""
    return {"url": url, "google": google, "google_error": gerr, "live": live, "diagnosis": diagnose(url, google, live, home, row.in_sitemap if row else None, str(stack))}


def inspect(db: Session, b: Business, urls: list[str] | None = None, limit: int = INSPECT_BATCH) -> dict[str, Any]:
    """Ask Google (URL Inspection API) about pages: the chosen ones, else the pages never checked, then the ones checked longest ago."""
    from . import gsc_access
    host = host_of(b)
    if not host:
        raise IndexingError("Add the project's website first.")
    state, msg, sc, site = gsc_access.search_console(db, b, host)
    if state != "ok":
        raise IndexingError(msg)
    rows = list(db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url.in_(urls)))) if urls else sorted(
        db.scalars(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.in_sitemap.is_(True))), key=lambda p: (p.g_checked_at is not None, _aware(p.g_checked_at) or _now()))
    rows = rows[:limit]
    done = {"indexed": 0, "not_indexed": 0, "blocked": 0, "unknown": 0}
    error = None

    def one(row: IndexPage):
        try:
            return row, parse_inspection(sc.inspect(site, row.url)), None
        except Exception as exc:  # noqa: BLE001 - Google's own reason (quota, permission)
            return row, None, str(exc)[:240]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for row, res, err in pool.map(one, rows):
            if err:
                error = error or err
                continue
            row.g_state, row.g_reason, row.g_last_crawl, row.g_canonical, row.g_checked_at = res["state"], res["reason"], res["last_crawl"], res["canonical"], _now()
            row.g_link = res["link"] or row.g_link
            done[res["state"]] += 1
    db.commit()
    return {"checked": sum(done.values()), **done, "error": error, "pages": {r.url: {"state": r.g_state, "link": r.g_link} for r in rows if r.g_checked_at}}


STAT_KEYS = ("total", "in_sitemap", "indexed", "not_indexed", "unchecked", "tech_ok", "tech_risky", "tech_blocked", "tech_unchecked", "sent", "pending")


def record_stats(db: Session, b: Business, counts: dict[str, int]) -> list[dict[str, Any]]:
    """Keep today's counts (the last look of the day wins) and give back the last 30 days, oldest first, for the graphs. A day nobody looked has no row: the graph skips it."""
    today = _now().date()
    row = db.get(IndexStatDay, (b.id, today))
    stats = {k: int(counts.get(k) or 0) for k in STAT_KEYS}
    if row is None:
        db.add(IndexStatDay(business_id=b.id, day=today, stats=stats))
    elif row.stats != stats:
        row.stats = stats
    db.flush()
    rows = list(db.scalars(select(IndexStatDay).where(IndexStatDay.business_id == b.id, IndexStatDay.day > today - timedelta(days=30)).order_by(IndexStatDay.day)))
    return [{"day": r.day.isoformat(), **(r.stats or {})} for r in rows]


def console_links(site: str) -> dict[str, str]:
    """Where to look in Search Console itself: the site's Page indexing report. A page's own inspection link is NOT built here: its `id` is one Google makes up, so the
    link comes from the URL Inspection API (inspectionResultLink) when the page is checked."""
    return {"index_url": f"https://search.google.com/search-console/index?resource_id={quote(site, safe='')}"}


def google_status(db: Session, b: Business) -> dict[str, Any]:
    """Whether Google can be asked about this site, and the sitemaps it knows."""
    from . import gsc_access
    host = host_of(b)
    if not host:
        return {"state": "no_site", "message": "Add the project's website to read its index status from Google."}
    try:
        state, msg, sc, site = gsc_access.search_console(db, b, host)
    except Exception:  # noqa: BLE001
        return {"state": "error", "message": "Search Console could not be reached right now."}
    if state != "ok":
        return {"state": state, "message": msg}
    maps = []
    try:
        for m in sc.sitemaps(site):
            maps.append({"path": m.get("path"), "last_submitted": m.get("lastSubmitted"), "last_downloaded": m.get("lastDownloaded"), "pending": m.get("isPending"),
                         "errors": int(m.get("errors") or 0), "warnings": int(m.get("warnings") or 0), "submitted": sum(int(c.get("submitted") or 0) for c in (m.get("contents") or []))})
    except Exception as exc:  # noqa: BLE001
        return {"state": "ok", "account": msg, "property": site, "sitemaps": [], "sitemaps_note": str(exc)[:200], **console_links(site)}
    return {"state": "ok", "account": msg, "property": site, "sitemaps": maps, "console_url": f"https://search.google.com/search-console/sitemaps?resource_id={site}", **console_links(site)}


# ------------------------------------------------------------------------------------------------------------------------ on its own
def run_auto(db: Session, b: Business, force: bool = False) -> dict[str, Any]:
    """The daily job: scan the sitemap, send new and changed pages to the other search engines, and ask Google about the pages it has not been asked about. Does nothing when automatic indexing is off."""
    st = setting(db, b)
    if not st.auto and not force:
        return {"skipped": "off"}
    out: dict[str, Any] = {}
    try:
        out.update(scan(db, b))
    except IndexingError as exc:
        out["note"] = str(exc)
        st.last_scan = {**(st.last_scan or {}), "note": out["note"]}
        db.commit()
        return out
    try:  # can each page be indexed at all: our own check, no Google account needed
        t = check_pages(db, b)
        out["checked_pages"], out["blocked_pages"], out["risky_pages"] = t["checked"], t["blocked"], t["risky"]
    except Exception as exc:  # noqa: BLE001 - the daily routine goes on
        out["tech_note"] = str(exc)[:160]
    if st.key_verified_at:
        try:
            r = submit(db, b)
            out["submitted"], out["skipped"] = r["sent"], len(r["skipped"])
        except IndexingError as exc:
            out["submit_note"] = str(exc)
    else:
        out["submit_note"] = "Waiting for the key file on the site: pages are found but not sent yet."
    try:
        c = inspect(db, b)
        out["inspected"] = c["checked"]
    except IndexingError as exc:
        out["google_note"] = str(exc)[:200]
    st = setting(db, b)
    st.last_scan = {**(st.last_scan or {}), **{k: v for k, v in out.items()}}
    db.commit()
    log(db, "system", "indexing_run", b.id, **{k: v for k, v in out.items() if isinstance(v, int)})
    db.commit()
    return out


def on_published(db: Session, b: Business, url: str) -> None:
    """A page the app has just published: record it at once and, when automatic indexing is on and the key file is in place, send it without waiting for the daily run. Never raises."""
    try:
        if not url or host_of(b) not in (urlsplit(url).hostname or "").lower().removeprefix("www."):
            return
        row = db.scalar(select(IndexPage).where(IndexPage.business_id == b.id, IndexPage.url == url[:1000]))
        if row is None:
            db.add(IndexPage(business_id=b.id, url=url[:1000], source="published", in_sitemap=True, first_seen_at=_now(), last_seen_at=_now()))
            db.flush()
        st = setting(db, b)
        db.commit()
        if st.auto and st.key_verified_at:
            import threading
            threading.Thread(target=_send_later, args=(b.id, url[:1000]), daemon=True).start()
    except Exception:  # noqa: BLE001
        logger.exception("Indexing a published page failed")
        db.rollback()


def _send_later(business_id: int, url: str, wait: float = 25.0) -> None:
    """Send a just-published page after a short wait (a site needs a moment before the new address opens), on a session of its own."""
    import time

    from ..db import SessionLocal
    time.sleep(wait)
    db = SessionLocal()
    try:
        b = db.get(Business, business_id)
        if b is not None:
            submit(db, b, [url])
    except Exception:  # noqa: BLE001
        logger.exception("Sending a published page for indexing failed")
    finally:
        db.close()
