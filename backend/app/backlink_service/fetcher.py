import asyncio
import logging
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from .config import Settings
from .renderer import Renderer, needs_rendering
from .robots import RobotsRules
from .urls import has_skipped_extension, is_blocked_host, normalize_url, resolves_to_public

log = logging.getLogger("backlink_service")

RETRY_STATUSES = {429, 500, 502, 503, 504}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
HTML_TYPES = ("text/html", "application/xhtml+xml")
TRANSIENT_ERRORS = (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)


class FetchError(Exception):
    """The page could not be read (HTTP error, network failure, too many redirects)."""


class Skip(Exception):
    """The URL was deliberately not fetched; the message says why."""


class RobotsUnreachable(Exception):
    """robots.txt of this origin cannot be read right now, so nothing on it is fetched."""

    def __init__(self, origin: str):
        super().__init__(f"robots.txt of {origin} is unreachable")
        self.origin = origin


@dataclass
class FetchedPage:
    url: str
    html: str
    nofollow: bool  # X-Robots-Tag header


class Fetcher:
    """Polite HTTP access shared by all workers: robots.txt, per-domain delay, retries with backoff,
    manual redirect checks, private/internal hosts blocked (also through DNS). No CAPTCHA/WAF bypass."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None,
                 renderer: Renderer | None = None):
        self.settings = settings
        self.transport = transport
        self.renderer = renderer or (Renderer(settings) if settings.render_js != "off" else None)
        self._client: httpx.AsyncClient | None = None
        self._robots: dict[str, tuple[RobotsRules, float]] = {}  # origin -> (rules, when they were read)
        self._slash_hosts: set[str] = set()  # sites that redirect /page to /page/: ask for the slash form at once
        self._robots_locks: dict[str, asyncio.Lock] = {}
        self._robots_fail: dict[str, tuple[int, float]] = {}  # origin -> (failed rounds, retry_at)
        self._host_locks: dict[str, asyncio.Lock] = {}
        self._host_next: dict[str, float] = {}
        self._host_delay: dict[str, float] = {}
        self._public_hosts: dict[str, tuple[bool, float]] = {}  # host -> (resolves to a public address, when that was looked up)

    def _say(self, msg: str, level: int = 1) -> None:
        if self.settings.verbose >= level:
            print(msg, flush=True)

    async def start(self) -> None:
        s = self.settings
        timeout = httpx.Timeout(connect=s.connect_timeout, read=s.read_timeout, write=s.write_timeout, pool=s.pool_timeout)
        self._client = httpx.AsyncClient(timeout=timeout, transport=self.transport, follow_redirects=False,
                                         headers={"User-Agent": s.user_agent})

    async def close(self) -> None:
        if self.renderer:
            await self.renderer.close()
        if self._client:
            await self._client.aclose()
            self._client = None

    # ---- pages -----------------------------------------------------------

    async def fetch(self, url: str) -> FetchedPage:
        """Raises Skip, FetchError or RobotsUnreachable."""
        current = self._with_slash(url)  # exact URL to request; redirects keep the server's own spelling
        for _ in range(self.settings.max_redirects + 1):
            reason = await self._skip_reason(current)
            if reason:
                raise Skip(reason)
            status, headers, body = await self._get_with_retry(current)
            if status in REDIRECT_STATUSES and headers.get("location"):
                nxt = urljoin(current, headers["location"]).split("#", 1)[0]
                if normalize_url(nxt) is None:
                    raise FetchError("invalid redirect target")
                if self._adds_slash(current, nxt):
                    self._slash_hosts.add(urlsplit(current).hostname or "")  # every page of this site costs one request, not two
                current = nxt
                continue
            if status >= 400:
                raise FetchError(f"HTTP {status}")
            if body is None:
                raise Skip("not an HTML page")
            robots_tag = headers.get("x-robots-tag", "").lower()
            body = await self._maybe_render(current, body)
            return FetchedPage(normalize_url(current), body, "nofollow" in robots_tag or "none" in robots_tag)
        raise FetchError("too many redirects")

    def _with_slash(self, url: str) -> str:
        parts = urlsplit(url)
        last = parts.path.rsplit("/", 1)[-1]
        if (parts.hostname or "") not in self._slash_hosts or parts.path.endswith("/") or "." in last:
            return url
        return urlunsplit((parts.scheme, parts.netloc, parts.path + "/", parts.query, ""))

    @staticmethod
    def _adds_slash(a: str, b: str) -> bool:
        pa, pb = urlsplit(a), urlsplit(b)
        return (pa.scheme == pb.scheme and pa.netloc == pb.netloc and pa.query == pb.query
                and not pa.path.endswith("/") and pb.path == pa.path + "/")

    async def _maybe_render(self, url: str, html: str) -> str:
        """Replace the plain HTML with the JavaScript-rendered DOM when enabled and useful."""
        mode = self.settings.render_js
        if not self.renderer or mode == "off" or (mode == "auto" and not needs_rendering(html)):
            return html
        await self._throttle(urlsplit(url).hostname or "")
        result = await self.renderer.render(url)
        if result is None:
            return html
        final_url, rendered = result
        if self._origin(final_url) != self._origin(url):  # redirects inside the browser are not robots-checked
            return html
        return rendered

    async def _skip_reason(self, url: str) -> str | None:
        if has_skipped_extension(url):
            return "file type is not an HTML page"
        host = urlsplit(url).hostname or ""
        self._trim()
        if is_blocked_host(host):
            return "private/internal host is not crawled"
        if self.settings.dns_check:
            now = asyncio.get_running_loop().time()
            known = self._public_hosts.get(host)
            if known is None or now - known[1] > self.settings.dns_ttl:  # the answer expires: a host's DNS can change during a crawl that runs for days
                known = self._public_hosts[host] = (await resolves_to_public(host), now)
            if not known[0]:
                return "host does not resolve to a public address"
        rp = await self._robots_for(url)  # may raise RobotsUnreachable
        if rp.disallow_all:
            return "robots.txt redirects to a non-public host, so the site is not crawled"
        if not rp.can_fetch(url):
            return "disallowed by robots.txt"
        return None

    async def _get_with_retry(self, url: str):
        """Returns (status, headers, html_text | None). Retries transient network errors and
        5xx/429 with exponential backoff; other HTTP errors are returned immediately."""
        s = self.settings
        host = urlsplit(url).hostname or ""
        for attempt in range(s.max_retries + 1):
            await self._throttle(host)
            retry = False
            try:
                async with self._client.stream("GET", url, headers={"Accept": "text/html,application/xhtml+xml"}) as resp:
                    status = resp.status_code
                    ctype = resp.headers.get("content-type", "").lower()
                    if status in RETRY_STATUSES and attempt < s.max_retries:
                        retry = True
                    elif status >= 300 or (ctype and not ctype.startswith(HTML_TYPES)):
                        return status, resp.headers, None
                    else:
                        chunks, size = [], 0
                        async for chunk in resp.aiter_bytes():
                            chunks.append(chunk)
                            size += len(chunk)
                            if size >= s.max_body_bytes:
                                break
                        text = b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")
                        return status, resp.headers, text
            except TRANSIENT_ERRORS as exc:
                if attempt == s.max_retries:
                    raise FetchError(repr(exc)) from exc
            except httpx.TransportError as exc:  # not transient (bad scheme, proxy, ...): do not retry
                raise FetchError(repr(exc)) from exc
            if retry or attempt < s.max_retries:
                await asyncio.sleep(min(s.backoff_max, s.backoff_base * 2 ** attempt))
        raise FetchError("retries exhausted")  # pragma: no cover

    async def _throttle(self, host: str) -> None:
        lock = self._host_locks.setdefault(host, asyncio.Lock())
        async with lock:
            loop = asyncio.get_running_loop()
            wait = self._host_next.get(host, 0.0) - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            self._host_next[host] = loop.time() + self._host_delay.get(host, self.settings.per_domain_delay)

    @staticmethod
    def _origin(url: str) -> str:
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.netloc}"

    # ---- bounded caches --------------------------------------------------

    def _trim(self) -> None:
        """The per-host and per-origin dictionaries only ever grew, and the crawler runs for days over up to 100,000 sites.
        Once any of them passes `max_cache_entries`, entries that no longer do anything are dropped: elapsed politeness gaps, idle locks,
        expired robots rules and DNS answers, and finished failure back-offs. If that is not enough, the oldest half goes. All of it is a
        cache: a dropped entry costs one repeated lookup, never a skipped check. Synchronous, so no other task can interleave."""
        s = self.settings
        cap = s.max_cache_entries
        if max(len(self._host_next), len(self._host_locks), len(self._robots), len(self._robots_locks), len(self._robots_fail),
               len(self._public_hosts), len(self._slash_hosts), len(self._host_delay)) <= cap:
            return
        now = asyncio.get_running_loop().time()
        for host in [h for h, t in self._host_next.items() if t <= now]:  # the politeness gap has passed: nothing left to wait for
            del self._host_next[host]
        for host in [h for h, lock in self._host_locks.items() if not lock.locked() and h not in self._host_next]:
            del self._host_locks[host]
        for origin in [o for o, (_, loaded) in self._robots.items() if now - loaded >= s.robots_ttl]:
            del self._robots[origin]
            self._host_delay.pop(urlsplit(origin).hostname or "", None)
        for origin in [o for o, lock in self._robots_locks.items() if not lock.locked() and o not in self._robots]:
            del self._robots_locks[origin]
        for origin in [o for o, (_, retry_at) in self._robots_fail.items() if now > retry_at + 900.0]:  # past the longest back-off
            del self._robots_fail[origin]
        for host in [h for h, (_, looked_up) in self._public_hosts.items() if now - looked_up > s.dns_ttl]:
            del self._public_hosts[host]
        # still too many live entries: keep the newest half
        for cache, age in ((self._robots, lambda v: v[1]), (self._public_hosts, lambda v: v[1]), (self._host_next, lambda v: v)):
            if len(cache) > cap:
                for key in sorted(cache, key=lambda k: age(cache[k]))[: len(cache) - cap // 2]:
                    del cache[key]
        if len(self._slash_hosts) > cap:
            self._slash_hosts.clear()  # re-learned from the next redirect: one extra request per site
        if len(self._host_delay) > cap:
            self._host_delay.clear()   # re-read with the next robots.txt

    # ---- robots.txt ------------------------------------------------------

    async def _robots_for(self, url: str) -> RobotsRules:
        """Cached rules per origin. An unreachable robots.txt raises RobotsUnreachable (never cached as 'blocked')."""
        origin = self._origin(url)
        loop = asyncio.get_running_loop()
        lock = self._robots_locks.setdefault(origin, asyncio.Lock())
        async with lock:
            entry = self._robots.get(origin)
            rp = entry[0] if entry and loop.time() - entry[1] < self.settings.robots_ttl else None
            if rp is None:
                fail = self._robots_fail.get(origin)
                if fail and loop.time() < fail[1]:
                    raise RobotsUnreachable(origin)
                rp = await self._load_robots(origin)
                if rp is None:
                    attempts = (fail[0] if fail else 0) + 1
                    delay = min(self.settings.robots_retry_delay * 2 ** (attempts - 1), 900.0)
                    self._robots_fail[origin] = (attempts, loop.time() + delay)
                    raise RobotsUnreachable(origin)
                self._robots[origin] = (rp, loop.time())
                self._robots_fail.pop(origin, None)
        return rp

    async def _load_robots(self, origin: str) -> RobotsRules | None:
        """200 -> parse rules, 4xx -> allow all, redirect to a private host -> disallow all.
        Network errors / 5xx / 429 are retried with backoff, then None (= unreachable, try again later)."""
        s = self.settings
        host = urlsplit(origin).hostname or ""
        for attempt in range(s.max_retries + 1):
            url = f"{origin}/robots.txt"
            resp = None
            try:
                for _ in range(4):  # follow a few redirects ourselves, checking every hop
                    await self._throttle(host)
                    resp = await self._client.get(url)
                    if resp.status_code in REDIRECT_STATUSES and resp.headers.get("location"):
                        nxt = urljoin(url, resp.headers["location"]).split("#", 1)[0]
                        if normalize_url(nxt) is None or is_blocked_host(urlsplit(nxt).hostname or ""):
                            return RobotsRules.block_all()
                        url, resp = nxt, None
                        continue
                    break
            except TRANSIENT_ERRORS:
                pass
            except httpx.TransportError:
                break
            else:
                if resp is not None and resp.status_code == 200:
                    rp = RobotsRules.parse(resp.text[:500_000], s.user_agent)
                    if rp.crawl_delay:
                        self._host_delay[host] = min(rp.crawl_delay, 10.0)
                    return rp
                if resp is not None and resp.status_code < 500 and resp.status_code != 429:
                    return RobotsRules.allow_all()  # 4xx: no robots.txt (RFC 9309)
            if attempt < s.max_retries:
                await asyncio.sleep(min(s.backoff_max, s.backoff_base * 2 ** attempt))
        return None
