"""Start/stop of the backlink service inside the platform's own process (called from app.main's lifespan)."""
import asyncio
import logging
from dataclasses import dataclass

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
    except Exception as exc:
        log.warning("Backlink service not started: %s", exc)
        state.db = state.worker = None


async def stop() -> None:
    if state.worker:
        await state.worker.stop()
    if state.db:
        state.db.dispose()
    state.db = state.worker = None
