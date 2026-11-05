import asyncio
import logging
import re
import sys
import threading
from typing import Callable
from urllib.parse import urlsplit

from .config import Settings
from .urls import is_blocked_host

log = logging.getLogger("backlink_service")

_SKIPPED_RESOURCES = {"image", "media", "font"}
_ANCHOR_RE = re.compile(r"<a[\s>]", re.I)
_SCRIPT_RE = re.compile(r"<script\b", re.I)
_SPA_HINTS = re.compile(
    r'id=["\'](?:root|app|__next|__nuxt)["\']|ng-app|data-reactroot|enable javascript|requires javascript', re.I)


def needs_rendering(html: str) -> bool:
    """Heuristic for 'auto' mode: scripts present and the static HTML looks empty or app-shell-like."""
    if not _SCRIPT_RE.search(html):
        return False
    return len(_ANCHOR_RE.findall(html)) < 10 or bool(_SPA_HINTS.search(html))


class _BrowserRenderer:
    """Renders pages in headless Chromium (Playwright) so links added by JavaScript become visible.

    The browser starts lazily on first use. If Playwright or its browser is missing the renderer
    disables itself and the crawler continues with the plain HTML.
    """

    def __init__(self, settings: Settings, blocked: Callable[[str], bool] = is_blocked_host):
        self.settings = settings
        self._blocked = blocked
        self._pw = None
        self._browser = None
        self._start_lock = asyncio.Lock()
        self._slots = asyncio.Semaphore(settings.render_concurrency)
        self.available: bool | None = None  # None = not tried yet

    async def _ensure_started(self) -> bool:
        async with self._start_lock:
            if self.available is None:
                try:
                    from playwright.async_api import async_playwright
                    self._pw = await async_playwright().start()
                    self._browser = await self._pw.chromium.launch(headless=True)
                    self.available = True
                except Exception as exc:
                    self.available = False
                    log.warning("JavaScript rendering disabled (%r). Install with: pip install playwright && "
                                "python -m playwright install chromium", exc)
                    print(f"JS RENDERING DISABLED ({exc!r}); run: python -m playwright install chromium", flush=True)
            return bool(self.available)

    async def render(self, url: str) -> tuple[str, str] | None:
        """Returns (final_url, rendered_html), or None if rendering is unavailable or failed."""
        if not await self._ensure_started():
            return None
        s = self.settings
        async with self._slots:
            context = await self._browser.new_context(user_agent=s.user_agent, java_script_enabled=True)
            try:
                page = await context.new_page()
                await page.route("**/*", self._route)
                await page.goto(url, wait_until="domcontentloaded", timeout=s.render_timeout * 1000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=s.render_settle * 1000)
                except Exception:
                    pass  # pages that never go idle (polling, analytics) are read as they are
                return page.url, await page.content()
            except Exception as exc:
                log.info("render failed for %s: %r", url, exc)
                return None
            finally:
                await context.close()

    async def _route(self, route) -> None:
        request = route.request
        parts = urlsplit(request.url)
        if (parts.scheme not in ("http", "https") or self._blocked(parts.hostname or "")
                or request.resource_type in _SKIPPED_RESOURCES):
            await route.abort()
        else:
            await route.continue_()

    async def close(self) -> None:
        try:
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        except Exception:
            pass
        self._browser = self._pw = None


class Renderer:
    """Same interface as _BrowserRenderer, but the browser lives on its own event loop in a background thread.

    Playwright starts Chromium as an asyncio subprocess, which Windows' selector event loop (the one uvicorn or a
    database driver may install) does not support (NotImplementedError). A dedicated loop (Proactor on Windows)
    works whatever loop the application runs on.
    """

    def __init__(self, settings: Settings, blocked: Callable[[str], bool] = is_blocked_host):
        self._args = (settings, blocked)
        self._inner: _BrowserRenderer | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def _ensure_thread(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop is None:
                loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
                self._thread = threading.Thread(target=loop.run_forever, name="backlink-renderer", daemon=True)
                self._loop = loop
                self._thread.start()
            return self._loop

    async def _render_here(self, url: str):
        if self._inner is None:  # created inside the render loop: its locks and semaphore belong to that loop
            self._inner = _BrowserRenderer(*self._args)
        return await self._inner.render(url)

    async def _close_here(self) -> None:
        if self._inner:
            await self._inner.close()

    async def render(self, url: str) -> tuple[str, str] | None:
        """Returns (final_url, rendered_html), or None if rendering is unavailable or failed."""
        loop = self._ensure_thread()
        return await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(self._render_here(url), loop))

    async def close(self) -> None:
        loop, thread = self._loop, self._thread
        if loop is None:
            return
        try:
            await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(self._close_here(), loop))
        finally:
            loop.call_soon_threadsafe(loop.stop)
            if thread:
                thread.join(timeout=5)
            self._loop = self._thread = self._inner = None
