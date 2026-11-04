"""Backlink report for a domain from the Ahrefs free Backlink Checker, saved in PostgreSQL (tables bl_ahrefs_reports / bl_ahrefs_pages).

The lookup is done by `ahrefs_backlinks.py` in the Fortress folder (a stealth Chromium that gets through Ahrefs' Cloudflare check). It runs
as a separate process with Fortress' own Python, so this backend needs neither Playwright nor the browser. It takes 30-120 seconds, so the API
only queues a report; a background task runs the lookup (one at a time) and stores the result.

The flow for businesses:
  * onboarding (trigger.start_for_website) queues a report for the business's website;
  * the scheduler (started with the platform, see lifecycle.py) runs queued reports one after another, and every day queues a new report for
    every business whose last one is older than AHREFS_REFRESH_HOURS. Each lookup is a new row, so the history stays;
  * clients read from the database only (GET /backlinks/ahrefs), never from Ahrefs.

Settings (environment variables, all optional):
    AHREFS_FORTRESS_DIR       folder with ahrefs_backlinks.py, .venv and browsers/   (default: <repo>/fortress-repo)
    AHREFS_TIMEOUT_SECONDS    give up on one lookup after this long                  (default: 240)
    AHREFS_CACHE_HOURS        a finished report younger than this is reused          (default: 24)
    AHREFS_AUTO               1: onboarding lookups and the daily refresh run; 0: off (default: 1)
    AHREFS_REFRESH_HOURS      a business is looked up again when its report is this old (default: 24)
    AHREFS_RETRY_HOURS        after a failed lookup, wait this long before trying that business again (default: 6)
    AHREFS_PAUSE_SECONDS      pause between two lookups of the scheduler            (default: 20)
"""
import asyncio
import json
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import timedelta
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from sqlalchemy import func, select, text, update

from .db import Database
from .models import AhrefsPage, AhrefsReport, utcnow

log = logging.getLogger("seo.backlinks.ahrefs")

MODES = ("subdomains", "exact", "prefix", "domain")
ACTIVE = ("queued", "running")
_run_lock = threading.Lock()  # one browser lookup at a time: Ahrefs throttles and a captcha is likelier under load

_HOST = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")


def timeout_seconds() -> int:
    return int(os.environ.get("AHREFS_TIMEOUT_SECONDS", "240"))


def cache_hours() -> float:
    return float(os.environ.get("AHREFS_CACHE_HOURS", "24"))


def auto_enabled() -> bool:
    return os.environ.get("AHREFS_AUTO", "1") == "1"


def refresh_hours() -> float:
    return float(os.environ.get("AHREFS_REFRESH_HOURS", "24"))


def retry_hours() -> float:
    return float(os.environ.get("AHREFS_RETRY_HOURS", "6"))


def pause_seconds() -> float:
    return float(os.environ.get("AHREFS_PAUSE_SECONDS", "20"))


def fortress_dir() -> Path:
    env = os.environ.get("AHREFS_FORTRESS_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[3] / "fortress-repo"


# ---- input and number parsing -------------------------------------------------

def normalize_domain(raw: str) -> str:
    """'https://www.Example.com/about' -> 'example.com'. Anything that is not a plain domain name raises ValueError. (The value goes to a command line, so
    it must start with a letter or digit and hold only host characters.)"""
    raw = (raw or "").strip().lower()
    if not raw:
        raise ValueError("empty domain")
    try:
        host = urlsplit(raw if "://" in raw else f"//{raw}").hostname or ""
        host = host.removeprefix("www.").encode("idna").decode("ascii")
    except (ValueError, UnicodeError):
        raise ValueError(f"invalid domain {raw!r}") from None
    if not _HOST.match(host):
        raise ValueError(f"invalid domain {raw!r}")
    return host


def parse_count(text: str | None) -> int | None:
    """'883' -> 883, '1,234' -> 1234, '1.2K' -> 1200, '3M' -> 3000000."""
    m = re.fullmatch(r"([\d.,]+)\s*([KMB]?)", (text or "").strip(), re.I)
    if not m:
        return None
    try:
        return int(round(float(m.group(1).replace(",", "")) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()]))
    except ValueError:
        return None


def _pct(text: str | None) -> int | None:
    m = re.fullmatch(r"\s*(\d+)\s*%\s*", text or "")
    return int(m.group(1)) if m else None


def _float(text: str | None) -> float | None:
    try:
        return float((text or "").strip().replace(",", ""))
    except ValueError:
        return None


def _clean(text) -> str:
    """PostgreSQL refuses NUL characters in text."""
    return str(text or "").replace("\x00", "")


# ---- the browser lookup ---------------------------------------------------------

def _kill_tree(proc: subprocess.Popen) -> None:
    # The scraper launches the browser; killing only python would orphan it.
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:  # the scraper runs in its own process group (start_new_session), which the browser joins
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def auto_setup_enabled() -> bool:
    return os.environ.get("AHREFS_AUTO_SETUP", "1") == "1"


_setup_lock = threading.Lock()


def ensure_fortress(folder: Path) -> None:
    """A fresh clone has the scraper but not its .venv or browser (they are not in git): run setup_fortress.py once to download them.
    Raises RuntimeError with the reason if Fortress still is not usable."""
    python = folder / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    setup = folder / "setup_fortress.py"
    if not (folder / "ahrefs_backlinks.py").is_file() or not setup.is_file():
        raise RuntimeError(f"Fortress is not at {folder} (needs ahrefs_backlinks.py and setup_fortress.py); set AHREFS_FORTRESS_DIR")
    check = [str(python), str(setup), "--check"]
    with _setup_lock:
        if python.is_file() and subprocess.run(check, cwd=str(folder), capture_output=True).returncode == 0:
            return
        if not auto_setup_enabled():
            raise RuntimeError(f"Fortress is not set up at {folder}; run: python {setup}")
        log.info("Setting up Fortress in %s (first Ahrefs lookup on this machine: downloads about 250 MB)", folder)
        try:
            done = subprocess.run([sys.executable, str(setup)], cwd=str(folder), capture_output=True, text=True, timeout=1800)
        except subprocess.TimeoutExpired:
            raise RuntimeError("Setting up Fortress took longer than 30 minutes") from None
        if done.returncode != 0:
            lines = (done.stderr or done.stdout).strip().splitlines()
            raise RuntimeError("Setting up Fortress failed: " + (lines[-1][:300] if lines else f"exit code {done.returncode}"))
        log.info("Fortress is set up")


_current_proc: subprocess.Popen | None = None  # the lookup running now, so a shutdown can stop it instead of waiting minutes


def abort_running() -> None:
    proc = _current_proc
    if proc is not None and proc.poll() is None:
        _kill_tree(proc)


def run_scraper(domain: str, mode: str, timeout: int | None = None) -> dict:
    """Run ahrefs_backlinks.py and return the JSON it prints. Raises RuntimeError if the process could not produce a result."""
    timeout = timeout or timeout_seconds()
    folder = fortress_dir()
    python = folder / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    script = folder / "ahrefs_backlinks.py"
    ensure_fortress(folder)
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}  # page titles hold emoji; a pipe would otherwise use the Windows code page
    global _current_proc
    proc = subprocess.Popen([str(python), str(script), domain, "--mode", mode], cwd=str(folder), env=env, text=True, encoding="utf-8", errors="replace",
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=os.name != "nt")
    _current_proc = proc
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_tree(proc)
        proc.communicate()
        raise RuntimeError(f"The Ahrefs lookup took longer than {timeout} seconds") from None
    finally:
        _current_proc = None
    start = out.find("{")
    if proc.returncode != 0 or start < 0:
        lines = err.strip().splitlines()
        raise RuntimeError("The Ahrefs lookup failed: " + (lines[-1][:300] if lines else f"exit code {proc.returncode}, no output"))
    try:
        return json.loads(out[start:])
    except ValueError:
        raise RuntimeError("The Ahrefs lookup returned output that is not JSON") from None


# ---- storage --------------------------------------------------------------------

QUEUED_MAX_HOURS = 24  # a queued report nobody ran for a day is dropped (the scheduler may be switched off)


def _fail_stale(s, now) -> None:
    """A job that died with its process (restart, crash) would stay running forever: fail it so the domain can be looked up again. Queued reports
    may wait a long time behind the daily refresh of every business, so only very old ones are dropped."""
    s.execute(update(AhrefsReport).where(AhrefsReport.status == "running", AhrefsReport.started_at < now - timedelta(seconds=timeout_seconds() + 600))
              .values(status="failed", error="interrupted (the server stopped before it finished)", finished_at=now))
    s.execute(update(AhrefsReport).where(AhrefsReport.status == "queued", AhrefsReport.requested_at < now - timedelta(hours=QUEUED_MAX_HOURS))
              .values(status="failed", error="never run (no scheduler picked it up)", finished_at=now))


def request_report(db: Database, domain: str, mode: str, refresh: bool = False, max_age_hours: float | None = None) -> tuple[AhrefsReport, str]:
    """Decide what a request for `domain` should do. Returns (report, kind): "in_progress" (one is already queued or running),
    "cached" (a finished one is younger than max_age_hours, default AHREFS_CACHE_HOURS; refresh=True skips this) or "queued" (a new report row
    was created: the caller starts the job, or the scheduler picks it up)."""
    now = utcnow()
    with db.session() as s:
        _fail_stale(s, now)
        same = (AhrefsReport.domain == domain, AhrefsReport.mode == mode)
        active = s.scalar(select(AhrefsReport).where(*same, AhrefsReport.status.in_(ACTIVE)).order_by(AhrefsReport.id.desc()).limit(1))
        if active:
            return active, "in_progress"
        if not refresh:
            age = cache_hours() if max_age_hours is None else max_age_hours
            fresh = s.scalar(select(AhrefsReport).where(*same, AhrefsReport.status == "done", AhrefsReport.finished_at >= now - timedelta(hours=age))
                             .order_by(AhrefsReport.id.desc()).limit(1))
            if fresh:
                return fresh, "cached"
        report = AhrefsReport(domain=domain, mode=mode, status="queued", requested_at=now)
        s.add(report)
        s.flush()
    return report, "queued"


def run_report(db: Database, report_id: int, runner: Callable[[str, str], dict] | None = None) -> None:
    """The background job: run the lookup for a queued report and store what it found (or why it failed). Never raises."""
    runner = runner or run_scraper
    with _run_lock:
        try:
            with db.session() as s:
                # Claim it: only a queued report is run, so the scheduler and a route's background task never run the same one twice.
                claimed = s.execute(update(AhrefsReport).where(AhrefsReport.id == report_id, AhrefsReport.status == "queued")
                                    .values(status="running", started_at=utcnow())).rowcount
                if not claimed:
                    return
                report = s.get(AhrefsReport, report_id)
                domain, mode = report.domain, report.mode
            try:
                data = runner(domain, mode)
                error = data.get("error")
            except Exception as exc:  # the lookup itself failed: keep the reason on the report
                log.warning("Ahrefs lookup for %s failed: %s", domain, exc)
                data, error = {}, str(exc)[:1000]
            _save(db, report_id, data, error)
        except Exception as exc:  # e.g. the database went away: do not leave the report "running"
            log.exception("Ahrefs report %s could not be saved", report_id)
            _save(db, report_id, {}, f"could not save the result: {exc}"[:1000])


def _save(db: Database, report_id: int, data: dict, error: str | None) -> None:
    try:
        with db.session() as s:
            report = s.get(AhrefsReport, report_id)
            if report is None:
                return
            report.finished_at = utcnow()
            if error:
                report.status, report.error = "failed", _clean(error)
                shot = data.get("screenshot")
                if shot:
                    report.error += f" (screenshot: {_clean(shot)})"
                return
            backlinks, sites = data.get("backlinks") or {}, data.get("linking_websites") or {}
            report.status, report.error = "done", None
            report.domain_rating = _float(data.get("domain_rating"))
            report.backlinks_value, report.backlinks_count = _clean(backlinks.get("value")) or None, parse_count(backlinks.get("value"))
            report.backlinks_dofollow_pct = _pct(backlinks.get("dofollow"))
            report.linking_websites_value, report.linking_websites_count = _clean(sites.get("value")) or None, parse_count(sites.get("value"))
            report.linking_websites_dofollow_pct = _pct(sites.get("dofollow"))
            s.add_all(AhrefsPage(report_id=report_id, position=i, dr=parse_count(p.get("dr")), page_title=_clean(p.get("referring_page_title")),
                                 page_url=_clean(p.get("referring_page_url")) or None, anchor_text=_clean(p.get("anchor_text")),
                                 target_url=_clean(p.get("target_url")) or None, redirects=[_clean(r) for r in p.get("redirects") or []])
                      for i, p in enumerate(data.get("referring_pages") or [], 1))
    except Exception as exc:
        log.exception("Ahrefs report %s: saving failed", report_id)
        try:
            with db.session() as s:  # the half-written transaction was rolled back; record the failure alone
                s.execute(update(AhrefsReport).where(AhrefsReport.id == report_id).values(status="failed", error=f"could not save the result: {exc}"[:1000], finished_at=utcnow()))
        except Exception:
            log.exception("Ahrefs report %s: could not even record the failure", report_id)  # request_report fails it as stale later


def latest_report_id(db: Database, domain: str, mode: str | None = None, status: str | None = None) -> int | None:
    with db.session() as s:
        q = select(AhrefsReport.id).where(AhrefsReport.domain == domain)
        if mode:
            q = q.where(AhrefsReport.mode == mode)
        if status:
            q = q.where(AhrefsReport.status == status)
        return s.scalar(q.order_by(AhrefsReport.id.desc()).limit(1))


def client_view(db: Database, domain: str, mode: str | None = None) -> dict | None:
    """What a client sees: the latest finished report, so the data never disappears while the daily refresh is queued or running (or after a
    refresh that failed). `refresh` says what happened to a newer lookup, if there is one. With no finished report yet, the newest attempt."""
    done_id = latest_report_id(db, domain, mode, "done")
    newest_id = latest_report_id(db, domain, mode)
    if newest_id is None:
        return None
    view = report_view(db, done_id or newest_id)
    newer = report_view(db, newest_id) if done_id and newest_id != done_id else None
    return view | {"refresh": {"report_id": newer["report_id"], "status": newer["status"], "error": newer["error"], "requested_at": newer["requested_at"]}
                   if newer else None}


def report_view(db: Database, report_id: int) -> dict | None:
    """A report in the shape the Ahrefs lookup returned it, plus its status."""
    with db.session() as s:
        r = s.get(AhrefsReport, report_id)
        if r is None:
            return None
        pages = list(s.scalars(select(AhrefsPage).where(AhrefsPage.report_id == r.id).order_by(AhrefsPage.position)))
        done = r.status == "done"
        return {
            "report_id": r.id, "domain": r.domain, "mode": r.mode, "status": r.status, "error": r.error,
            "requested_at": r.requested_at, "started_at": r.started_at, "finished_at": r.finished_at,
            "domain_rating": f"{r.domain_rating:g}" if done and r.domain_rating is not None else None,
            "backlinks": {"value": r.backlinks_value, "dofollow": f"{r.backlinks_dofollow_pct}%" if r.backlinks_dofollow_pct is not None else None} if done else None,
            "linking_websites": {"value": r.linking_websites_value, "dofollow": f"{r.linking_websites_dofollow_pct}%" if r.linking_websites_dofollow_pct is not None else None} if done else None,
            "referring_pages": [{"dr": str(p.dr) if p.dr is not None else "", "referring_page_title": p.page_title, "referring_page_url": p.page_url, "anchor_text": p.anchor_text,
                                 "target_url": p.target_url, "redirects": p.redirects or []} for p in pages],
        }


# ---- businesses: onboarding and the daily refresh --------------------------------------

_wake = threading.Event()  # set when onboarding queues a report, so the scheduler starts it now instead of at its next look
AHREFS_LOCK_KEY = 7_274_002  # PostgreSQL advisory lock: one scheduler across all API processes


def queue_for_website(db: Database, website: str | None) -> dict:
    """Onboarding: queue an Ahrefs report for the business's website (the scheduler runs it within seconds). Nothing is queued when a recent
    report exists or one is already waiting. Never raises: onboarding must not break because of this."""
    try:
        if not auto_enabled():
            return {"queued": False, "reason": "AHREFS_AUTO is off"}
        try:
            domain = normalize_domain(website or "")
        except ValueError:
            return {"queued": False, "reason": "no valid website"}
        report, kind = request_report(db, domain, "subdomains", max_age_hours=refresh_hours())
        _wake.set()
        return {"queued": kind == "queued", "domain": domain, "report_id": report.id, "state": kind}
    except Exception:  # noqa: BLE001
        log.exception("Could not queue the Ahrefs report for %s", website)
        return {"queued": False, "reason": "error"}


def business_domains() -> list[str]:
    """The domain of every business that is not paused (the same set the crawler searches for)."""
    from .business_sync import business_targets

    out = []
    for target in business_targets():
        try:
            out.append(normalize_domain(target))
        except ValueError:
            continue
    return list(dict.fromkeys(out))


def queue_due(db: Database, domains: list[str]) -> int:
    """The daily refresh: queue a report for each domain whose last finished one is older than AHREFS_REFRESH_HOURS (or that has none).
    A domain whose last lookup failed waits AHREFS_RETRY_HOURS before it is tried again. Returns how many were queued."""
    since = utcnow() - timedelta(hours=retry_hours())
    queued = 0
    for domain in domains:
        same = (AhrefsReport.domain == domain, AhrefsReport.mode == "subdomains")
        with db.session() as s:
            newest = s.scalar(select(func.max(AhrefsReport.id)).where(*same))
            recent_fail = s.scalar(select(func.max(AhrefsReport.id)).where(*same, AhrefsReport.status == "failed", AhrefsReport.finished_at >= since))
        if newest is not None and newest == recent_fail:  # its last lookup failed a short while ago: try again later
            continue
        _, kind = request_report(db, domain, "subdomains", max_age_hours=refresh_hours())
        queued += kind == "queued"
    if queued:
        log.info("Ahrefs daily refresh: %d of %d business domains queued", queued, len(domains))
    return queued


def next_queued_id(db: Database) -> int | None:
    """The report waiting longest (onboarding and the daily refresh in the order they were asked for)."""
    with db.session() as s:
        return s.scalar(select(AhrefsReport.id).where(AhrefsReport.status == "queued").order_by(AhrefsReport.requested_at, AhrefsReport.id).limit(1))


def _acquire_lock(db: Database):
    """Returns a connection holding the lock, True on SQLite (nothing to lock), or None when another process runs the scheduler."""
    if db.engine.dialect.name != "postgresql":
        return True
    conn = db.engine.connect()
    if conn.execute(text("select pg_try_advisory_lock(:k)"), {"k": AHREFS_LOCK_KEY}).scalar():
        return conn
    conn.close()
    return None


def _release_lock(conn) -> None:
    if conn in (None, True):
        return
    try:
        conn.execute(text("select pg_advisory_unlock(:k)"), {"k": AHREFS_LOCK_KEY})
    finally:
        conn.close()


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    """Sleep, waking early on shutdown or when onboarding queued a report."""
    end = time.monotonic() + seconds
    while time.monotonic() < end and not stop.is_set() and not _wake.is_set():
        await asyncio.sleep(min(1.0, end - time.monotonic()))


async def scheduler(db: Database, stop: asyncio.Event, look_every: float = 60.0, sync_every: float = 600.0) -> None:
    """Runs in the platform process: every `sync_every` seconds it queues the businesses that are due (daily refresh), and it runs the queued
    reports one after another with a pause between them. Only one process runs it (advisory lock); the others leave it to that one."""
    lock = None
    while not stop.is_set():  # another API process may hold the lock; take over when it stops
        lock = await asyncio.to_thread(_acquire_lock, db)
        if lock is not None:
            break
        await _sleep(stop, 300)
    if lock is None:
        return
    log.info("Ahrefs scheduler running: every business is looked up again after %g h", refresh_hours())
    last_sync = float("-inf")
    try:
        while not stop.is_set():
            try:
                if time.monotonic() - last_sync >= sync_every:
                    last_sync = time.monotonic()
                    await asyncio.to_thread(lambda: queue_due(db, business_domains()))
                _wake.clear()
                report_id = await asyncio.to_thread(next_queued_id, db)
                if report_id is not None:
                    await asyncio.to_thread(run_report, db, report_id)
                    await _sleep(stop, pause_seconds())
                    continue
            except Exception:  # noqa: BLE001 - e.g. the database is briefly unreachable: try again at the next look
                log.exception("Ahrefs scheduler step failed")
            await _sleep(stop, look_every)
    finally:
        await asyncio.to_thread(_release_lock, lock)
