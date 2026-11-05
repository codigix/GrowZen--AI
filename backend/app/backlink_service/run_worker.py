"""The crawler as its own process (no routes). Run from backend/:

    python -m app.backlink_service.run_worker

It reads seeds and targets from PostgreSQL and writes the backlinks it finds back. The API process
(uvicorn app.main:app) never crawls; it only saves targets/seeds and reads backlinks.
"""
import asyncio
import logging
import signal

from . import repository as repo
from .config import Settings
from .db import Database
from .worker import Worker


async def main() -> None:
    settings = Settings()
    db = Database(settings)
    await asyncio.to_thread(db.create_tables)
    await asyncio.to_thread(repo.load_seed_file, db, settings.seed_file)
    worker = Worker(db, settings)
    try:
        await worker.start()
    except RuntimeError as exc:
        print(f"Not started: {exc}", flush=True)
        db.dispose()
        raise SystemExit(1)
    slots_text = (f"businesses in groups of {settings.slot_businesses}, {settings.slot_hours:g} h per group"
                  if settings.slot_hours > 0 else "no time slots")
    print(f"Backlink crawler running: {settings.workers} sites at a time, {slots_text}. "
          + ("Crawling now." if settings.autostart else "Waiting for POST /api/v1/backlinks/crawl."), flush=True)
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_running_loop().add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows: Ctrl+C arrives as KeyboardInterrupt instead
            pass
    try:
        await stop.wait()
    finally:
        await worker.stop()
        db.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Crawler stopped.", flush=True)
