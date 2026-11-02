"""Policy-aware fetching, page processing and backlink verification.

`PageFetcher` enforces robots.txt (RFC 9309), per-host politeness, SSRF-safe connections (every redirect hop re-validated),
redirect and size caps, and Retry-After. `process_source_page` turns one fetched page into lifecycle observations for every
backlink that page is known to carry, plus new links to monitored targets. Nothing here bypasses auth, paywalls or CAPTCHAs.
"""
import hashlib
import logging
import warnings
import zlib
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import utcnow
from ..services.url_safety import SSRFSafeTransport, SSRFValidationError
from . import frontier, renderer, robots
from .extract import PageExtract, extract_page
from .lifecycle import FetchEvidence, LinkEvidence, apply_crawl_observation
from .models import Backlink, BacklinkProvenance, BiDomain, BiPage, BiTrackedTarget, CrawlAttempt, FrontierUrl
from .repository import get_domain, get_page
from .urls import normalize_url, registrable_domain, text_hash, url_hash

log = logging.getLogger("seo.backlinks.engine")
MAX_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 5
ROBOTS_TTL = timedelta(hours=24)
DEFAULT_DELAY = 2.0  # seconds between requests to one host
HTML_TYPES = ("text/html", "application/xhtml+xml")
XML_TYPES = ("application/xml", "text/xml", "application/rss+xml", "text/plain", "application/gzip", "application/x-gzip", "application/octet-stream")
# Very large platforms: crawling them yields no backlink discoveries for the budget they would eat.
SKIP_DOMAINS = frozenset({"google.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com", "youtube.com", "youtu.be", "pinterest.com",
                          "wikipedia.org", "amazon.com", "apple.com", "microsoft.com", "github.com", "tiktok.com", "reddit.com", "whatsapp.com", "t.me",
                          "wa.me", "goo.gl", "bit.ly", "play.google.com", "maps.google.com", "cloudflare.com", "wordpress.org", "wordpress.com", "w3.org"})
MAX_SITEMAP_URLS = 200
OWN_SITE_PRIORITY = 15.0  # a tracked site's own inner pages: only useful for the outbound links they reveal
OUTWARD_PRIORITY = 50.0  # first step out from a tracked site; each further hop is 10 lower
MAX_SITEMAP_CHILDREN = 20


@dataclass
class FetchResult:
    url: str
    status: int | None = None
    body: str | None = None
    final_url: str | None = None
    error_code: str | None = None  # robots_disallowed | ssrf_blocked | timeout | network | unsupported_content_type | too_large
    complete: bool = True
    retry_after: float | None = None
    bytes: int = 0
    ms: int = 0
    rendered: bool = False  # the body is the page after JavaScript ran (headless Chrome), not the raw HTML
    render_error: str | None = None

    @property
    def redirected(self) -> bool:
        return bool(self.final_url and self.final_url != self.url)


def aware(dt: datetime) -> datetime:
    """SQLite hands back naive datetimes; everything stored here is UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def make_client(timeout: float = 15) -> httpx.Client:
    return httpx.Client(transport=SSRFSafeTransport(retries=0), headers={"User-Agent": robots.USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
                        follow_redirects=True, max_redirects=MAX_REDIRECTS, timeout=timeout)


def _retry_after(h: str | None) -> float | None:
    try:
        return max(0.0, min(float(h), 3600)) if h else None
    except ValueError:
        return None


class PageFetcher:
    def __init__(self, client: httpx.Client | None = None, sleep=time.sleep, clock=time.monotonic, default_delay: float = DEFAULT_DELAY, render_fn=None):
        self.client = client or make_client()
        self._render = render_fn  # None = the real headless-Chrome renderer (looked up at call time)
        self._sleep, self._clock, self.default_delay = sleep, clock, default_delay
        self._last: dict[str, float] = {}
        self._backoff: dict[str, float] = {}  # host -> monotonic time before which we must not call (from 429 Retry-After)

    def _wait(self, host: str, delay: float) -> None:
        now = self._clock()
        wait = max(self._last.get(host, -1e9) + delay - now, self._backoff.get(host, 0) - now, 0)
        if wait > 0:
            self._sleep(wait)
        self._last[host] = self._clock()

    def _raw_get(self, db: Session, url: str, domain: BiDomain, purpose: str, delay: float) -> FetchResult:
        started = utcnow()
        t0 = self._clock()
        res = FetchResult(url=url)
        self._wait(domain.host, delay)
        try:
            with self.client.stream("GET", url) as r:
                sni = r.request.extensions.get("sni_hostname")  # SSRFSafeTransport pins the request to an IP and keeps the real host here
                if isinstance(sni, bytes):
                    sni = sni.decode()
                res.status, res.final_url = r.status_code, str(r.url.copy_with(host=sni) if sni else r.url)
                if r.status_code == 429 or r.status_code == 503:
                    res.retry_after = _retry_after(r.headers.get("retry-after"))
                    self._backoff[domain.host] = self._clock() + (res.retry_after or 60)
                ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
                if 200 <= r.status_code < 300 and purpose != "robots" and ctype and ctype not in (HTML_TYPES + (XML_TYPES if purpose == "sitemap" else ())):
                    res.error_code, res.complete = "unsupported_content_type", False
                else:
                    buf = bytearray()
                    for chunk in r.iter_bytes():
                        buf += chunk
                        if len(buf) > MAX_BYTES:  # applies to decompressed bytes
                            res.complete, res.error_code = False, "too_large"
                            break
                    res.bytes = len(buf)
                    raw = bytes(buf[:MAX_BYTES])
                    if purpose == "sitemap" and raw[:2] == b"\x1f\x8b":  # a .xml.gz sitemap: unpack it, never beyond the size cap
                        try:
                            raw = zlib.decompressobj(wbits=31).decompress(raw, MAX_BYTES)
                        except zlib.error:
                            res.error_code, res.complete = "bad_gzip", False
                            raw = b""
                    res.body = raw.decode(r.encoding or "utf-8", errors="replace")
        except SSRFValidationError as exc:
            res.error_code, res.complete = "ssrf_blocked", False
            log.info("Blocked %s: %s", url, exc)
        except httpx.TimeoutException:
            res.error_code, res.complete = "timeout", False
        except (httpx.TransportError, httpx.TooManyRedirects, ValueError) as exc:
            res.error_code, res.complete = ("too_many_redirects" if isinstance(exc, httpx.TooManyRedirects) else "network"), False
        res.ms = int((self._clock() - t0) * 1000)
        db.add(CrawlAttempt(url=url, domain_id=domain.id, purpose=purpose, http_status=res.status, response_time_ms=res.ms, response_bytes=res.bytes,
                            error_code=res.error_code, started_at=started))
        return res

    def rules_for(self, db: Session, domain: BiDomain, scheme: str = "https") -> robots.RobotsRules:
        now = utcnow()
        if domain.robots_status and domain.robots_expires_at and aware(domain.robots_expires_at) > now:
            return robots.RobotsRules(disallow_all=True) if domain.robots_status == "unreachable" else robots.parse(domain.robots_txt or "")
        res = self._raw_get(db, f"{scheme}://{domain.host}/robots.txt", domain, "robots", self.default_delay)
        rules, label = robots.from_response(res.status, res.body)
        domain.robots_status, domain.robots_txt, domain.robots_expires_at = label, (res.body if label == "ok" else None), now + (ROBOTS_TTL if label != "unreachable" else timedelta(hours=1))
        return rules

    def fetch(self, db: Session, url: str, purpose: str = "discovery", render: "renderer.RenderBudget | None" = None) -> FetchResult:
        try:
            norm = normalize_url(url)
        except ValueError:
            return FetchResult(url=url, error_code="invalid_url", complete=False)
        domain = get_domain(db, norm)
        rules = self.rules_for(db, domain, norm.split(":", 1)[0])
        if not rules.allowed(norm):
            return FetchResult(url=norm, error_code="robots_disallowed", complete=False)
        delay = max(rules.delay() or 0, self.default_delay)
        res = self._raw_get(db, norm, domain, purpose, delay)
        if render is not None and res.complete and res.body and res.status and 200 <= res.status < 300 and renderer.looks_js_rendered(res.body) and render.take():
            try:  # a JavaScript app shell: let a real browser build the page, and keep the result only if it actually has more links
                html = (self._render or renderer.render)(norm)
                if len(extract_page(html, norm).links) > len(extract_page(res.body, norm).links):
                    res.body, res.rendered = html, True
            except renderer.RenderError as exc:
                res.render_error = str(exc)[:200]
                log.info("Not rendered %s: %s", norm, exc)
        domain.last_crawled_at = utcnow()
        domain.next_crawl_at = utcnow() + timedelta(seconds=max(delay, res.retry_after or 0))  # politeness holds across runs, not just within one
        return res


def _reg(url: str) -> str:
    return registrable_domain(url.split("/")[2].split(":")[0])


def tracked_domains(db: Session, only_enabled: bool = True) -> set[str]:
    q = select(BiTrackedTarget.domain)
    if only_enabled:
        q = q.where(BiTrackedTarget.monitoring_enabled.is_(True))
    return set(db.scalars(q))


def process_source_page(db: Session, page: BiPage, res: FetchResult, monitored: set[str] | None = None, now: datetime | None = None,
                        discover: bool = True) -> dict:
    """Apply one fetch of `page` to the graph. Returns counts. Caller commits.

    - Known backlinks on the page get an observation: found, absent (on a complete fetch), or no evidence (fetch failed).
    - With `discover`, links on the page to monitored target domains that we did not know yet are added as crawler-sourced backlinks.
    """
    now = now or utcnow()
    monitored = monitored if monitored is not None else tracked_domains(db)
    known = list(db.scalars(select(Backlink).where(Backlink.source_page_id == page.id)))
    out = {"links_seen": 0, "new_backlinks": 0, "observed": 0, "links_to_monitored": 0}
    extract: PageExtract | None = None
    readable = bool(res.complete and res.status is not None and (200 <= res.status < 300 or res.status in (404, 410)))
    if res.status is not None and 200 <= res.status < 300 and res.body and res.complete:
        extract = extract_page(res.body, res.final_url or page.normalized_url)
        page.title = extract.title
        page.snippet = extract.snippet
        page.content_hash = hashlib.sha256(res.body.encode("utf-8", "ignore")).hexdigest()
    page.http_status, page.last_crawled_at = res.status, now

    found: list = []
    if extract is not None:
        found = list(extract.links)
        out["links_seen"] = len(found)
        out["links_to_monitored"] = sum(1 for ln in found if not ln.internal and _reg(ln.target_url) in monitored)

    # Pair the links we already track on this page with the links found now. Same target and same anchor wins first, so reordering the
    # links on a page does not swap their identities; whatever is left is paired in page order. Unpaired known links are absent from the
    # page; unpaired found links to a monitored domain are new backlinks.
    found_by_target: dict[bytes, list] = {}
    for ln in found:
        found_by_target.setdefault(url_hash(ln.target_url), []).append(ln)
    known_by_target: dict[bytes, list[Backlink]] = {}
    for bl in known:
        known_by_target.setdefault(bl.target_url_hash, []).append(bl)
    paired: dict[int, object] = {}
    new_links: list = []
    for th in set(found_by_target) | set(known_by_target):
        unused = list(found_by_target.get(th, []))
        left = []
        for bl in sorted(known_by_target.get(th, []), key=lambda x: x.instance):
            match = next((f for f in unused if bl.anchor_hash and text_hash(f.anchor_text) == bl.anchor_hash), None)
            if match is not None:
                paired[bl.id] = match
                unused.remove(match)
            else:
                left.append(bl)
        for bl, f in zip(left, unused):
            paired[bl.id] = f
        new_links += unused[len(left):]
    if extract is not None and discover:
        next_instance: dict[bytes, int] = {th: max((b.instance for b in bl_list), default=-1) + 1 for th, bl_list in known_by_target.items()}
        for ln in new_links:
            if ln.internal or _reg(ln.target_url) not in monitored:
                continue
            th = url_hash(ln.target_url)
            instance = next_instance.get(th, 0)
            next_instance[th] = instance + 1
            target_domain = get_domain(db, ln.target_url, now)
            bl = Backlink(source_page_id=page.id, source_domain_id=page.domain_id, target_domain_id=target_domain.id, target_url=ln.target_url,
                          target_url_hash=th, instance=instance, anchor_text=ln.anchor_text, anchor_hash=text_hash(ln.anchor_text), link_type=ln.link_type,
                          rel_attributes=ln.rel_attributes, placement=ln.placement, current_status="UNKNOWN", verification_status="UNVERIFIED")
            db.add(bl)
            db.flush()
            db.add(BacklinkProvenance(backlink_id=bl.id, source="codigix_crawler", imported_at=now, provider_observed_at=now, license_class="internal"))
            known.append(bl)
            paired[bl.id] = ln
            out["new_backlinks"] += 1

    for bl in known:
        ln = paired.get(bl.id) if extract is not None else None
        link = LinkEvidence(ln.anchor_text, ln.rel_attributes, ln.placement, ln.link_type) if ln is not None else None
        apply_crawl_observation(db, bl, FetchEvidence(source_http_status=res.status, complete=res.complete,
                                                     link=link, redirected_to=res.final_url if res.redirected else None, error_code=res.error_code), now)
        out["observed"] += 1
    return out


def verify_source_page(db: Session, fetcher: PageFetcher, source_url: str, monitored: set[str] | None = None, render=None) -> dict:
    """Fetch a source page and update every backlink it carries. Fetch failures never mark links lost."""
    page = get_page(db, source_url)
    res = fetcher.fetch(db, page.normalized_url, "verification", render)
    out = process_source_page(db, page, res, monitored)
    out.update(url=page.normalized_url, http_status=res.status, error_code=res.error_code)
    return out


def crawl_sitemap(db: Session, fetcher: PageFetcher, row: FrontierUrl, monitored: set[str] | None = None) -> dict:
    """Read a sitemap or sitemap index: queue its pages (same site only, capped) or its child sitemaps."""
    res = fetcher.fetch(db, row.url, "sitemap")
    out = {"url": row.url, "http_status": res.status, "error_code": res.error_code, "links_seen": 0, "new_backlinks": 0, "observed": 0, "queued": 0}
    if res.error_code in ("robots_disallowed",):
        row.status, row.last_error = "blocked", res.error_code
    elif res.error_code in ("ssrf_blocked", "unsupported_content_type") or (res.status and 400 <= res.status < 500 and res.status != 429):
        row.status, row.last_error = "dead", res.error_code or f"http_{res.status}"
    elif res.status is None or res.status == 429 or (res.status or 0) >= 500:
        frontier.fail(db, row, res.error_code or f"http_{res.status}", retry_after=res.retry_after)
    else:
        frontier.complete(db, row)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)  # the lenient parser reads <loc> fine and never fetches anything
            soup = BeautifulSoup(res.body or "", "html.parser")
        site = _reg(row.url)
        locs = [t.get_text(strip=True) for t in soup.find_all("loc")]
        child = bool(soup.find("sitemap"))
        for loc in locs[: MAX_SITEMAP_CHILDREN if child else MAX_SITEMAP_URLS]:
            try:
                if _reg(normalize_url(loc)) != site:
                    continue  # a sitemap may only vouch for its own site
            except (ValueError, IndexError):
                continue
            if frontier.enqueue(db, loc, "sitemap" if child else "sitemap_url", 1 if child else row.depth + 1, row.url, priority=OWN_SITE_PRIORITY if site in (monitored or ()) else max(0.0, row.priority - 10), hop=row.hop or 0):
                out["queued"] += 1
    return out


def crawl_row(db: Session, fetcher: PageFetcher, row: FrontierUrl, monitored: set[str] | None = None, follow_depth: int = 2, max_hops: int = 0, render=None) -> dict:
    """Process one claimed frontier row: fetch, update graph, enqueue what to explore next, and finish or retry the row.

    Exploration, in priority order: pages that link to a monitored domain (their whole site is worth a look), a tracked site's own pages and
    sitemaps, and external pages those sites link to, up to `max_hops` hops away. All of it is budgeted by the caller."""
    monitored = monitored if monitored is not None else tracked_domains(db)
    if row.source == "sitemap":
        return crawl_sitemap(db, fetcher, row, monitored)
    page = get_page(db, row.url)
    res = fetcher.fetch(db, row.url, "verification" if row.queue == "verification" else "discovery", render)
    out = process_source_page(db, page, res, monitored)
    out.update(url=row.url, http_status=res.status, error_code=res.error_code, queued=0, rendered=res.rendered)
    hop = row.hop or 0
    if res.error_code == "robots_disallowed":
        row.status, row.last_error = "blocked", "robots_disallowed"
    elif res.error_code == "ssrf_blocked" or res.error_code == "unsupported_content_type":
        row.status, row.last_error = "dead", res.error_code
    elif res.status is None or res.status == 429 or (res.status or 0) >= 500:
        frontier.fail(db, row, res.error_code or f"http_{res.status}", retry_after=res.retry_after)
    else:
        frontier.complete(db, row)
        if res.status < 300 and res.body and res.complete:
            ex = extract_page(res.body, res.final_url or row.url)
            site = _reg(row.url)
            if row.source == "seed" and row.depth == 0:  # a tracked site's front door: find its sitemaps
                rules = fetcher.rules_for(db, get_domain(db, row.url), row.url.split(":", 1)[0])
                for sm in [*rules.sitemaps, f"{row.url.split('/')[0]}//{row.url.split('/')[2]}/sitemap.xml"]:
                    if frontier.enqueue(db, sm, "sitemap", 0, row.url, priority=70.0, hop=0):
                        out["queued"] += 1
            if out["links_to_monitored"] and site not in monitored:  # a proven linker: it may well link again, so look at more of it
                for u in (f"{row.url.split('/')[0]}//{row.url.split('/')[2]}/", f"{row.url.split('/')[0]}//{row.url.split('/')[2]}/sitemap.xml"):
                    if frontier.enqueue(db, u, "sitemap" if u.endswith(".xml") else "linker", 0, row.url, priority=85.0, hop=0):
                        out["queued"] += 1
            if not ex.nofollow_all:
                for ln in ex.links:
                    if ln.internal:
                        if row.depth < follow_depth and frontier.enqueue(db, ln.target_url, "link", row.depth + 1, row.url,
                                                                         priority=OWN_SITE_PRIORITY if site in monitored else max(0.0, row.priority - 5), hop=hop):
                            out["queued"] += 1
                    elif hop < max_hops:
                        tgt = _reg(ln.target_url)
                        if tgt not in monitored and tgt not in SKIP_DOMAINS and frontier.enqueue(db, ln.target_url, "link", 0, row.url, priority=max(0.0, OUTWARD_PRIORITY - 10 * hop), hop=hop + 1):
                            out["queued"] += 1
    return out


def run_batch(db: Session, fetcher: PageFetcher, limit: int = 10, max_hops: int = 0) -> list[dict]:
    """One worker tick: claim fair work from the frontier and process it. Commits after each URL so a crash loses at most one."""
    frontier.recover_stale(db)
    monitored = tracked_domains(db)
    rows = frontier.take_next(db, limit)
    db.commit()
    results = []
    for row in rows:
        try:
            results.append(crawl_row(db, fetcher, row, monitored, max_hops=max_hops))
        except Exception as exc:  # one bad page must not stop the batch; the row is retried
            db.rollback()
            row = db.merge(row)
            frontier.fail(db, row, f"{type(exc).__name__}: {exc}")
            log.exception("Crawl of %s failed", row.url)
        db.commit()
    return results


def schedule_verifications(db: Session, limit: int = 500, now: datetime | None = None) -> int:
    """Queue source pages of backlinks that are due for re-verification (one frontier row per source page)."""
    now = now or utcnow()
    n = 0
    due = db.execute(select(BiPage.normalized_url).join(Backlink, Backlink.source_page_id == BiPage.id)
                     .where(Backlink.next_verify_at.is_not(None), Backlink.next_verify_at <= now).group_by(BiPage.normalized_url).limit(limit))
    for (url,) in due:
        row = frontier.enqueue(db, url, "recheck", 0, priority=80.0, queue="verification", now=now)
        if row is not None:
            n += 1
    return n
