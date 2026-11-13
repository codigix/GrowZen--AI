"""Page X-Ray history and the whole-site scan.

History: every X-Ray the person runs can be saved against the project, so a page's SEO / AEO / GEO scores can be followed over time.
Whole-site scan: every page of the project's OWN website is X-Rayed in the background (3 at a time) and saved as history; progress is kept in
a PageXRayJob row that the page polls.

Real data only: a saved report is either read by this server (source 'server' / 'site') or sent back by the browser right after an X-Ray
(source 'client'): the browser copy is replaced by our own cached copy of the same X-Ray when we still have it.
"""
import inspect
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import Business, PageXRayJob, PageXRayRun
from . import crawler, page_xray

MAX_RUNS = 200  # saved X-Rays kept per project (the oldest are dropped)
MAX_REPORT_BYTES = 300_000
MAX_PAGES = 100
SCANS_PER_HOUR = 5  # whole-site scans per project per hour
WORKERS = 3
_ACTIVE: set[int] = set()  # job ids that a thread of THIS process is running (a restart empties it: those jobs are dead)
_lock = threading.Lock()


class HistoryError(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message, self.status = message, status


# ---- reading a report

def _int(v: Any, lo: int = 0, hi: int = 100) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else None


def validate_report(report: Any) -> dict[str, Any]:
    """The report must look like a Page X-Ray result: a url and three scores. Nothing else about it is trusted."""
    if not isinstance(report, dict) or not isinstance(report.get("url"), str) or not report["url"].strip():
        raise HistoryError("That is not a Page X-Ray report.")
    scores = report.get("scores")
    if not isinstance(scores, dict):
        raise HistoryError("The report has no scores.")
    for k in ("seo", "aeo", "geo"):
        s = scores.get(k)
        if not isinstance(s, dict) or _int(s.get("score")) is None or _int(s.get("passed"), 0, 500) is None or _int(s.get("total"), 0, 500) is None:
            raise HistoryError(f"The {k.upper()} score in the report is not valid.")
        if not isinstance(s.get("checks", []), list):
            raise HistoryError("The report's checks are not valid.")
    return report


def summarise(report: dict[str, Any]) -> dict[str, Any]:
    scores = report["scores"]
    failed = [c.get("key") for k in ("seo", "aeo", "geo") for c in scores[k].get("checks", []) if isinstance(c, dict) and c.get("passed") is False and c.get("key")]
    content = report.get("content") if isinstance(report.get("content"), dict) else {}
    return {
        "final_url": str(report.get("final_url") or "")[:1000] or None,
        "render": bool(report.get("rendering")),
        "seo_score": scores["seo"]["score"], "aeo_score": scores["aeo"]["score"], "geo_score": scores["geo"]["score"],
        "passed": {k: [scores[k]["passed"], scores[k]["total"]] for k in ("seo", "aeo", "geo")},
        "failed_keys": failed[:80],
        "word_count": _int(content.get("word_count"), 0, 10_000_000),
        "status": _int(report.get("status"), 0, 999),
    }


def _fit(report: dict[str, Any]) -> dict[str, Any] | None:
    """The report as stored: whole when it is small enough, otherwise with the bulkiest parts dropped, never cut in the middle."""
    def size(r: dict[str, Any]) -> int:
        return len(json.dumps(r, default=str))
    r = dict(report)
    if size(r) <= MAX_REPORT_BYTES:
        return r
    for part in ("rendering", "social"):
        r.pop(part, None)
    if isinstance(r.get("content"), dict):
        r["content"] = {k: v for k, v in r["content"].items() if k != "outline"}
    return r if size(r) <= MAX_REPORT_BYTES else None


# ---- saving

def _prune(db: Session, business_id: int) -> None:
    n = db.scalar(select(func.count(PageXRayRun.id)).where(PageXRayRun.business_id == business_id)) or 0
    if n <= MAX_RUNS:
        return
    old = list(db.scalars(select(PageXRayRun.id).where(PageXRayRun.business_id == business_id).order_by(PageXRayRun.created_at.asc(), PageXRayRun.id.asc()).limit(n - MAX_RUNS)))
    if old:
        db.execute(delete(PageXRayRun).where(PageXRayRun.id.in_(old)))


def save_run(db: Session, b: Business, report: dict[str, Any], source: str = "server") -> PageXRayRun:
    validate_report(report)
    s = summarise(report)
    try:
        url = page_xray.normalise_url(report["url"])
    except Exception:  # noqa: BLE001 - a report whose address cannot be normalised is still the person's own snapshot
        url = report["url"].strip()
    row = PageXRayRun(business_id=b.id, url=url[:1000], source=source, report=_fit(report), **s)
    db.add(row)
    db.flush()
    _prune(db, b.id)
    db.commit()
    return row


def server_copy(user_id: str, report: dict[str, Any], cache: dict[Any, Any]) -> dict[str, Any] | None:
    """Our own cached copy of the X-Ray this browser report claims to be (same user, same address), if we still have one."""
    wanted = {str(report.get("url") or ""), str(report.get("final_url") or "")} - {""}
    for key, val in list(cache.items()):
        try:
            if str(key[0]) != str(user_id):
                continue
            cached = val[1]
            if {str(cached.get("url") or ""), str(cached.get("final_url") or "")} & wanted:
                return cached
        except (TypeError, IndexError, AttributeError):
            continue
    return None


# ---- reading

def _row_summary(r: PageXRayRun) -> dict[str, Any]:
    return {"id": r.id, "url": r.url, "final_url": r.final_url, "render": r.render, "seo": r.seo_score, "aeo": r.aeo_score, "geo": r.geo_score,
            "passed": r.passed, "word_count": r.word_count, "status": r.status, "source": r.source, "created_at": r.created_at.isoformat() if r.created_at else None}


def history(db: Session, b: Business, url: str | None, limit: int = 50) -> list[dict[str, Any]]:
    q = select(PageXRayRun).where(PageXRayRun.business_id == b.id)
    if url:
        q = q.where(PageXRayRun.url == _norm(url))
    rows = list(db.scalars(q.order_by(PageXRayRun.created_at.desc(), PageXRayRun.id.desc()).limit(max(1, min(limit, 200)))))
    out = []
    for i, r in enumerate(rows):
        item = _row_summary(r)
        older = next((o for o in rows[i + 1:] if o.url == r.url), None)  # the run of this same page before this one
        item["change"] = {"seo": r.seo_score - older.seo_score, "aeo": r.aeo_score - older.aeo_score, "geo": r.geo_score - older.geo_score} if older else None
        out.append(item)
    return out


def trend(db: Session, b: Business, url: str) -> list[dict[str, Any]]:
    rows = list(db.scalars(select(PageXRayRun).where(PageXRayRun.business_id == b.id, PageXRayRun.url == _norm(url)).order_by(PageXRayRun.created_at.desc(), PageXRayRun.id.desc()).limit(100)))
    return [{"id": r.id, "at": r.created_at.isoformat() if r.created_at else None, "seo": r.seo_score, "aeo": r.aeo_score, "geo": r.geo_score} for r in reversed(rows)]


def get_run(db: Session, b: Business, run_id: int) -> PageXRayRun | None:
    r = db.get(PageXRayRun, run_id)
    return r if r and r.business_id == b.id else None


def _norm(url: str) -> str:
    try:
        return page_xray.normalise_url(url)
    except Exception:  # noqa: BLE001
        return (url or "").strip()


# ---- the whole-site scan

def _host(url: str) -> str:
    return (urlsplit(url if "://" in url else f"https://{url}").hostname or "").lower().removeprefix("www.")


def _call_run(url: str) -> dict[str, Any]:
    """page_xray.run, with the Chrome render switched off (a whole-site scan reads the raw HTML)."""
    if "render" in inspect.signature(page_xray.run).parameters:
        return page_xray.run(url, render=False)
    return page_xray.run(url)


_memo_depth = 0
_memo_orig: dict[str, Any] = {}


class _SiteMemo:
    """During a scan the registration, the certificate and robots.txt are the same for every page of the site: ask once, not per page."""
    NAMES = ("rdap_lookup", "check_ssl", "fetch_small")

    def __enter__(self):
        global _memo_depth
        with _lock:
            if _memo_depth == 0:
                for name in self.NAMES:
                    fn = getattr(page_xray, name, None)
                    if fn is None:
                        continue
                    _memo_orig[name] = fn
                    cache: dict[Any, Any] = {}
                    guard = threading.Lock()

                    def wrapped(*a, _fn=fn, _cache=cache, _guard=guard, **kw):
                        key = (a, tuple(sorted(kw.items())))
                        with _guard:
                            if key in _cache:
                                return _cache[key]
                        out = _fn(*a, **kw)
                        with _guard:
                            _cache[key] = out
                        return out
                    setattr(page_xray, name, wrapped)
            _memo_depth += 1

    def __exit__(self, *exc):
        global _memo_depth
        with _lock:
            _memo_depth -= 1
            if _memo_depth == 0:
                for name, fn in _memo_orig.items():
                    setattr(page_xray, name, fn)
                _memo_orig.clear()


def latest_job(db: Session, b: Business) -> PageXRayJob | None:
    return db.scalar(select(PageXRayJob).where(PageXRayJob.business_id == b.id).order_by(PageXRayJob.id.desc()).limit(1))


def job_view(db: Session, job: PageXRayJob) -> dict[str, Any]:
    if job.status == "running" and job.id not in _ACTIVE:  # the process that ran it is gone
        job.status, job.error = "failed", job.error or "Interrupted: the server restarted before the scan finished. Run it again."
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    return {"id": job.id, "status": job.status, "phase": job.phase, "done": job.done, "total": job.total, "max_pages": job.max_pages, "pages": job.pages or [], "error": job.error,
            "started_at": job.created_at.isoformat() if job.created_at else None, "finished_at": job.finished_at.isoformat() if job.finished_at else None}


def start_site_scan(db: Session, b: Business, max_pages: int, actor: str) -> PageXRayJob:
    if not (b.website or "").strip() or "." not in _host(b.website):
        raise HistoryError("Add the project's website first: the scan reads the project's own site.")
    max_pages = max(5, min(int(max_pages), MAX_PAGES))
    last = latest_job(db, b)
    if last and job_view(db, last)["status"] == "running":
        raise HistoryError("A scan of this website is already running.", 409)
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = db.scalar(select(func.count(PageXRayJob.id)).where(PageXRayJob.business_id == b.id, PageXRayJob.created_at >= since)) or 0
    if recent >= SCANS_PER_HOUR:
        raise HistoryError(f"A project can be scanned {SCANS_PER_HOUR} times per hour. Try again later.", 429)
    job = PageXRayJob(business_id=b.id, status="running", max_pages=max_pages, phase="discovering", pages=[], started_by=(actor or "")[:120])
    db.add(job)
    db.commit()
    db.refresh(job)
    with _lock:
        _ACTIVE.add(job.id)  # from now until the background run ends (or the process dies), this scan counts as running
    return job


def discover_pages(b: Business, max_pages: int) -> list[str]:
    """The pages of the project's own website, found by the same crawler the Site Audit uses. Other hosts are never returned."""
    cfg = dict(b.audit_config or {})
    cfg["subdomains"] = False
    site = crawler.crawl(b.website, max_pages=max_pages, options=cfg)
    own = _host(b.website)
    urls: list[str] = []
    for p in site.get("pages", []):
        u = str(p.get("url") or "")
        if not u or _host(u) != own or u in urls:
            continue
        if p.get("status") not in (None, 200):
            continue
        urls.append(u)
    return urls[:max_pages]


def run_site_scan(db: Session, job_id: int) -> None:
    """Background job (see deps.in_background): find the pages, X-Ray each (3 at a time) and save every result as history."""
    job = db.get(PageXRayJob, job_id)
    if not job:
        return
    b = db.get(Business, job.business_id)
    with _lock:
        _ACTIVE.add(job.id)
    try:
        urls = discover_pages(b, job.max_pages)
        job.total, job.phase = len(urls), "scanning"
        if not urls:
            job.status, job.error, job.finished_at = "done", "No pages were found on the website to scan.", datetime.now(timezone.utc)
            db.commit()
            return
        db.commit()
        pages: list[dict[str, Any]] = []
        with _SiteMemo(), ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(_call_run, u): u for u in urls}
            for fut in as_completed(futures):
                u = futures[fut]
                try:
                    report = fut.result()
                    run = save_run(db, b, report, source="site")
                    top = (report.get("summary") or [{}])[0].get("label")
                    pages.append({"url": u, "run_id": run.id, "seo": run.seo_score, "aeo": run.aeo_score, "geo": run.geo_score, "status": run.status, "top_fix": top, "error": None})
                except Exception as exc:  # noqa: BLE001 - one page that fails must not stop the scan
                    msg = getattr(exc, "message", None) or str(exc)
                    pages.append({"url": u, "run_id": None, "seo": None, "aeo": None, "geo": None, "status": None, "top_fix": None, "error": str(msg)[:200]})
                job.pages, job.done = list(pages), len(pages)
                db.commit()
        job.status, job.finished_at = "done", datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - the reason is shown on the page
        db.rollback()
        job = db.get(PageXRayJob, job_id)
        job.status, job.error, job.finished_at = "failed", str(getattr(exc, "message", None) or exc)[:300], datetime.now(timezone.utc)
        db.commit()
    finally:
        with _lock:
            _ACTIVE.discard(job_id)
