"""One place for the small helper threads a process starts on its own (the start-up warm-up, the dashboard refresh, ...), so none of them is started twice, none can end silently with an unlogged
error, and shutdown can ask all of them to stop and wait for them for a moment.

`run_single(name, fn)` runs `fn` in a daemon thread unless a thread of that name is already running (it then returns False: the work is already being done). `STOP` is set at shutdown;
a long-running helper looks at it between its steps. `on_stop(callback)` lets a component that waits on its own condition (the indexing sender) be woken at shutdown.
"""
import logging
import threading
from typing import Callable

log = logging.getLogger("seo.lifecycle")
STOP = threading.Event()
_lock = threading.Lock()
_threads: dict[str, threading.Thread] = {}
_callbacks: list[Callable[[], None]] = []


def run_single(name: str, fn: Callable[..., None], *args) -> bool:
    """Start `fn(*args)` in a thread called `name`, unless one of that name is still running. Exceptions are logged, never lost. Returns whether it was started."""
    with _lock:
        t = _threads.get(name)
        if t is not None and t.is_alive():
            return False

        def run() -> None:
            try:
                fn(*args)
            except Exception:  # noqa: BLE001
                log.exception("Background helper %s failed", name)
            finally:
                with _lock:
                    if _threads.get(name) is threading.current_thread():
                        _threads.pop(name, None)

        t = threading.Thread(target=run, daemon=True, name=name)
        _threads[name] = t
        t.start()
        return True


def running() -> list[str]:
    with _lock:
        return [n for n, t in _threads.items() if t.is_alive()]


def on_stop(callback: Callable[[], None]) -> None:
    if callback not in _callbacks:
        _callbacks.append(callback)


def stop_all(timeout: float = 5.0) -> list[str]:
    """Shutdown: ask every helper to stop and wait up to `timeout` seconds in all. Returns the names still running (daemon threads, so they cannot hold the process up)."""
    STOP.set()
    for cb in list(_callbacks):
        try:
            cb()
        except Exception:  # noqa: BLE001
            log.exception("A shutdown callback failed")
    import time
    end = time.monotonic() + timeout
    with _lock:
        threads = list(_threads.values())
    for t in threads:
        t.join(max(0.0, end - time.monotonic()))
    left = running()
    if not left:
        STOP.clear()  # shutdown is complete: the signal does not outlive it (a process that starts again, or a test that starts the app again, begins clean)
    return left


def reset() -> None:
    """For a new start in the same process (tests): clear the stop signal."""
    STOP.clear()
