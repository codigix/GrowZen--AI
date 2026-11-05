"""Start/stop of the backlink service inside the platform's own process (called from app.main's lifespan)."""
import asyncio
import logging
from dataclasses import dataclass

from . import ahrefs
from . import repository as repo
from .config import Settings
from .db import Database
from .worker import Worker

log = logging.getLogger("seo")


@dataclass
class State:
    db: Database | None = None
    settings: Settings | None = None
    worker: Worker | None = None
    ahrefs_task: asyncio.Task | None = None  # onboarding lookups + daily refresh of every business (ahrefs.scheduler)
    ahrefs_stop: asyncio.Event | None = None


state = State()


async def start() -> None:
    """Create the bl_* tables, load seed.json, start the continuous crawl. Never stops the platform from starting."""
    try:
        settings = state.settings = Settings()
        state.db = Database(settings)
        await asyncio.to_thread(state.db.create_tables)
        await asyncio.to_thread(repo.load_seed_file, state.db, settings.seed_file)
        if settings.worker_enabled:
            try:
                state.worker = Worker(state.db, settings)
                await state.worker.start()
            except Exception as exc:  # e.g. another crawler process is already running: the routes keep working
                log.warning("Backlink crawler not started in this process: %s", exc)
                state.worker = None
        if ahrefs.auto_enabled():
            state.ahrefs_stop = asyncio.Event()
            state.ahrefs_task = asyncio.create_task(ahrefs.scheduler(state.db, state.ahrefs_stop))
    except Exception as exc:
        log.warning("Backlink service not started: %s", exc)
        state.db = state.worker = None


async def stop() -> None:
    if state.ahrefs_task:
        state.ahrefs_stop.set()
        ahrefs.abort_running()  # a lookup in progress is stopped (its report is marked failed) instead of holding up the shutdown
        try:
            await asyncio.wait_for(state.ahrefs_task, timeout=15)
        except Exception as exc:  # noqa: BLE001
            log.warning("Ahrefs scheduler did not stop cleanly: %s", exc)
        state.ahrefs_task = state.ahrefs_stop = None
    if state.worker:
        await state.worker.stop()
    if state.db:
        state.db.dispose()
    state.db = state.worker = None
