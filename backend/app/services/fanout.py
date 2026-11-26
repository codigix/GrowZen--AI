"""A ThreadPoolExecutor whose tasks are limited for the whole process.

Many requests start a small pool of their own to ask several outside services at once (DNS, Google, Moz, a website's pages). Each pool is small, but fifty requests at the same
time started fifty of them. Here every task takes one of FANOUT_MAX places before it runs, so however many requests fan out together, only that many outside calls are in flight
from this process; the others wait their turn. The API is the one of `concurrent.futures.ThreadPoolExecutor`, so a module only changes its import.

A task that itself starts a pool (a fan-out inside a fan-out) runs the inner tasks inside the place it already holds, so the two levels can never wait for each other.
Waiting for a place holds nothing: no database connection, no lock.
"""
import os
import threading
from concurrent import futures


def _limit() -> int:
    try:
        from app.config import get_settings  # noqa: PLC0415 - read when this module is first used, so the .env value counts
        return max(4, int(get_settings().fanout_max))
    except Exception:  # noqa: BLE001
        try:
            return max(4, int(os.environ.get("FANOUT_MAX", "48") or 48))
        except ValueError:
            return 48


MAX_FANOUT = _limit()
_slots = threading.BoundedSemaphore(MAX_FANOUT)
_tls = threading.local()
_lock = threading.Lock()
_stats = {"running": 0, "waiting": 0, "peak_running": 0, "peak_waiting": 0, "started": 0}


def stats() -> dict[str, int]:
    """How many outside tasks run and wait right now in this process, and the most there have been (for monitoring and tests)."""
    with _lock:
        return {**_stats, "limit": MAX_FANOUT}


def _gated(inherit: bool, fn, *args, **kwargs):
    if inherit or getattr(_tls, "gated", False):
        return fn(*args, **kwargs)  # inside a place that is already held
    with _lock:
        _stats["waiting"] += 1
        _stats["peak_waiting"] = max(_stats["peak_waiting"], _stats["waiting"])
    _slots.acquire()
    with _lock:
        _stats["waiting"] -= 1
        _stats["running"] += 1
        _stats["started"] += 1
        _stats["peak_running"] = max(_stats["peak_running"], _stats["running"])
    _tls.gated = True
    try:
        return fn(*args, **kwargs)
    finally:
        _tls.gated = False
        with _lock:
            _stats["running"] -= 1
        _slots.release()


class ThreadPoolExecutor(futures.ThreadPoolExecutor):
    def submit(self, fn, /, *args, **kwargs):
        return super().submit(_gated, bool(getattr(_tls, "gated", False)), fn, *args, **kwargs)
