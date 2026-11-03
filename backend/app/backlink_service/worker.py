import asyncio
import logging
import time
from datetime import datetime

import httpx

from . import business_sync
from . import repository as repo
from . import slots
from .config import Settings, parse_offpeak
from .crawler import crawl_site
from .db import Database
from .fetcher import Fetcher
from .urls import TargetMatcher

log = logging.getLogger("backlink_service")


class Worker:
    """Continuous background crawl: claims the next due site from the database, reads it, stores the
    backlinks it finds, adds newly discovered sites to the seed table, and moves on. Never ends by itself."""

    def __init__(self, db: Database, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.db = db
        self.settings = settings
        self.fetcher = Fetcher(settings, transport)
        self._wake = asyncio.Event()
        self._slot: tuple[int, float] | None = None  # (slot index, unix time when it ends), cached between looks at the database
        self._slot_lock = asyncio.Lock()
        self._slot_logged = -1
        self._lock_conn = None  # the PostgreSQL advisory lock that keeps a second crawler process out
        self._tasks: list[asyncio.Task] = []

    def _say(self, msg: str) -> None:
        if self.settings.verbose >= 1:
            print(msg, flush=True)

    def wake(self) -> None:
        """Called (embedded mode) by POST /backlinks/crawl: look at the database now instead of waiting."""
        self._wake.set()

    def notify(self) -> None:
        """New seeds were saved: wake idle workers so they look again. Does not start a crawler that is not running."""
        self._wake.set()

    async def start(self) -> None:
        self._lock_conn = await asyncio.to_thread(repo.acquire_crawler_lock, self.db)
        if self._lock_conn is None:
            raise RuntimeError("Another backlink crawler is already running (only one may run at a time). Stop it first.")
        await self.fetcher.start()
        await asyncio.to_thread(repo.reset_interrupted, self.db)
        # After every start the crawler waits for POST /backlinks/crawl (unless BACKLINK_DB_AUTOSTART=1).
        await asyncio.to_thread(repo.set_crawl_enabled, self.db, self.settings.autostart)
        self._tasks = [asyncio.create_task(self._run(i)) for i in range(self.settings.workers)]
        if self.settings.auto_businesses:
            self._tasks.append(asyncio.create_task(self._business_loop()))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []
        await self.fetcher.close()
        await asyncio.to_thread(repo.release_crawler_lock, self._lock_conn)
        self._lock_conn = None

    def allowed_workers(self, now: datetime | None = None) -> int:
        """Full speed inside the quiet-hours window (or always when none is set), fewer sites at a time outside it."""
        s = self.settings
        window = parse_offpeak(s.offpeak_hours)
        if window is None:
            return s.workers
        hour, (start, end) = (now or datetime.now()).hour, window
        inside = start <= hour < end if start < end else (hour >= start or hour < end)
        return s.workers if inside else min(s.workers, max(1, s.daytime_workers))

    def overloaded(self) -> bool:
        """CPU or memory of this machine is above the limits (needs psutil; without it there is no governor)."""
        try:
            import psutil
        except ImportError:
            return False
        return (psutil.cpu_percent(interval=None) > self.settings.max_cpu_percent
                or psutil.virtual_memory().percent > self.settings.max_memory_percent)

    async def _slot_index(self) -> int:
        """The current time slot. A new slot is one more pass over all seeds, for the next group of businesses."""
        now = time.time()
        if self._slot and now < self._slot[1]:
            return self._slot[0]
        length = self.settings.slot_hours * 3600
        async with self._slot_lock:
            if self._slot and time.time() < self._slot[1]:
                return self._slot[0]
            index, started, advanced = await asyncio.to_thread(repo.current_slot, self.db, length)
            if advanced:
                due = await asyncio.to_thread(repo.start_pass, self.db, started)
                self._say(f"SLOT   new time slot #{index + 1}: {due} site(s) due again")
            self._slot = (index, started.timestamp() + length)
            return index

    async def _active_targets(self, targets: list, quiet: bool = False) -> list:
        """The businesses searched right now: everyone when there is one group, else this slot's group of five."""
        s = self.settings
        if slots.plain_mode(len(targets), s.slot_businesses, s.slot_hours):
            return targets
        index = await self._slot_index()
        group, n_groups = slots.group_for_slot(targets, s.slot_businesses, index)
        # A business onboarded within the last slot length is searched at once, besides the group whose turn it is.
        fresh = slots.fresh_targets(targets, group, s.slot_hours * 3600)
        if quiet:
            return group + fresh
        if index != self._slot_logged:
            self._slot_logged = index
            self._say(f"SLOT   group {index % n_groups + 1} of {n_groups} for {s.slot_hours:g} h: "
                      + ", ".join(t.domain for t in group))
        if fresh:
            self._say(f"FRESH  also searching new business(es): {', '.join(t.domain for t in fresh)}")
        return group + fresh

    async def _business_loop(self) -> None:
        while True:
            try:
                added = await asyncio.to_thread(business_sync.sync, self.db, self.settings)
                if added:
                    self._say(f"BUSINESS {added} new business website(s) added as targets")
                    self._wake.set()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # e.g. the businesses table is not reachable: try again next round
                log.warning("business sync failed: %s", exc)
            await asyncio.sleep(self.settings.business_sync_interval)

    async def _run(self, n: int) -> None:
        while True:
            try:
                # worker 0 never pauses, so progress continues even under load or in the daytime window
                paused = n >= self.allowed_workers() or (n > 0 and self.overloaded())
                worked = False if paused else await self.process_one()
            except asyncio.CancelledError:
                raise
            except Exception:  # one bad site must not stop the worker
                log.exception("worker %s failed", n)
                worked = False
            if not worked:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=self.settings.idle_sleep)
                except asyncio.TimeoutError:
                    pass

    async def process_one(self) -> bool:
        """Crawl the next due site. False when there is nothing to do (no targets yet, or no site is due)."""
        s = self.settings
        if not await asyncio.to_thread(repo.crawl_enabled, self.db):
            return False  # waiting for POST /backlinks/crawl
        targets = await asyncio.to_thread(repo.list_targets, self.db)
        if not targets:
            return False
        active = await self._active_targets(targets)
        seed = await asyncio.to_thread(repo.claim_seed, self.db)
        if seed is None:
            return False
        matchers = [TargetMatcher(t.target, t.match_mode) for t in active]
        all_matchers = [TargetMatcher(t.target, t.match_mode) for t in targets]
        limit = s.seed_pages_per_site if seed.source == "seed" else s.discovered_pages_per_site
        self._say(f"SITE   crawling {seed.site_key} ({seed.source}, up to {limit} pages)")

        async def save(rows: list[dict]) -> None:
            await asyncio.to_thread(repo.save_backlinks, self.db, rows)

        active_ids = {t.id for t in active}
        try:
            result = await crawl_site(self.fetcher, seed.url, limit, s.max_depth, matchers, save, self._say,
                                      max_queue=s.max_queue_per_site, max_query_variants=s.max_query_variants)
            error = result.error
        except asyncio.CancelledError:
            await asyncio.shield(asyncio.to_thread(repo.finish_seed, self.db, seed.id, 0, "interrupted", 0, 0))
            raise
        except Exception as exc:
            log.exception("crawl of %s failed", seed.site_key)
            result, error = None, f"{type(exc).__name__}: {exc}"
        pages = result.pages if result else 0

        recrawl = s.recrawl_after
        try:
            if result and s.discover_seeds and result.external_urls:
                # a target's own website is never a place to look for backlinks to it
                candidates = [u for u in result.external_urls.values() if not any(m.is_target_site(u) for m in all_matchers)]
                new = await asyncio.to_thread(repo.add_seeds, self.db, candidates, "discovered", s.max_seeds)
                self._say(f"SEEDS  {seed.site_key}: {new} new site(s) added, {len(result.external_urls)} linked")
            # The businesses searched may have changed while this site was being read (one was onboarded, or a new time
            # slot began). The site was read for the old set only, so it is read again soon, not after a whole cycle.
            targets_now = await asyncio.to_thread(repo.list_targets, self.db)
            active_now = await self._active_targets(targets_now, quiet=True)
            if {t.id for t in active_now} != active_ids:
                recrawl = 0.0
        except asyncio.CancelledError:
            await asyncio.shield(asyncio.to_thread(repo.finish_seed, self.db, seed.id, 0, "interrupted", 0, 0))
            raise
        except Exception:  # whatever happens here, the site must leave the 'crawling' state
            log.exception("steps after the crawl of %s failed", seed.site_key)
        await asyncio.to_thread(repo.finish_seed, self.db, seed.id, pages, error, recrawl, s.retry_after, seed.url)
        self._say(f"DONE   {seed.site_key}: {pages} pages, {result.backlinks if result else 0} backlink(s)"
                  + (f", error: {error}" if error else ""))
        return True
