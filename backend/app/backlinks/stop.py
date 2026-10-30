"""A shutdown flag for the long background jobs (discovery bot runs up to ~2.5 minutes, competitor watch up to ~8).

When the server is stopped (Ctrl+C, a reload, a deploy) the web server waits for running threads before it exits; without this a crawl in progress makes the
shutdown hang until it finishes. The jobs check the flag between pages, save what they have, and leave. Nothing is lost: pages claimed but unfinished are
handed back by the frontier's stale-work recovery, and an interrupted watch simply runs again at the next tick."""
import threading

STOP = threading.Event()


def stopping() -> bool:
    return STOP.is_set()
