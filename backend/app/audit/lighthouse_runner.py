"""Runs Lighthouse audits in the background: SSRF checks, de-duplication, per-engine limits, storage.

Each engine has its own worker pool. Local Lighthouse starts a real Chrome per audit, so its pool
is small (LIGHTHOUSE_MAX_CONCURRENT_LOCAL); PageSpeed Insights is only an HTTP call to Google, so
its pool is larger (LIGHTHOUSE_MAX_CONCURRENT_PAGESPEED). When PageSpeed fails, the audit falls back
to local Lighthouse through the local pool, so the Chrome limit still holds.

Every audit is stored (status `queued`) before it runs, and report files are written under
LIGHTHOUSE_REPORTS_DIR, so history and downloads survive a restart. Audits still queued/running at
start-up are marked failed, since nothing will resume them. Like the scheduler, this suits a single
API instance; several instances need a real job queue (e.g. RQ/Celery + Redis).
"""
import json
import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal
from ..models import LighthouseAudit
from . import lighthouse, lighthouse_report, pagespeed
from .url_safety import SSRFValidationError, ValidatedURL, resolve_and_validate, validate_url_shape

log = logging.getLogger("seo.lighthouse")

DUPLICATE_WINDOW = timedelta(seconds=120)
ENGINE_ERRORS = (pagespeed.PageSpeedError, lighthouse.LighthouseError)

_pools: dict[str, ThreadPoolExecutor] = {}
_lock = threading.Lock()
_active = 0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _pool(engine: str) -> ThreadPoolExecutor:
    with _lock:
        if engine not in _pools:
            s = get_settings()
            workers = s.lighthouse_max_concurrent_pagespeed if engine == "pagespeed" else s.lighthouse_max_concurrent_local
            _pools[engine] = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix=f"lighthouse-{engine}")
        return _pools[engine]


def active_count() -> int:
    return _active


def stop() -> None:
    """Drop queued work (it is marked failed on the next start) and let running audits finish."""
    with _lock:
        for p in _pools.values():
            p.shutdown(wait=False, cancel_futures=True)
        _pools.clear()


def recover_interrupted(db: Session) -> int:
    stuck = list(db.scalars(select(LighthouseAudit).where(LighthouseAudit.status.in_(["queued", "running"]))))
    for a in stuck:
        a.status, a.error_message, a.completed_at = "failed", "Interrupted by a server restart before completion.", _now()
    db.commit()
    if stuck:
        log.warning("Marked %d interrupted Lighthouse audit(s) as failed", len(stuck))
    return len(stuck)


def find_recent_duplicate(db: Session, url: str, strategy: str, engine: str) -> LighthouseAudit | None:
    """The same URL/strategy/engine still queued or running from the last two minutes."""
    cutoff = _now() - DUPLICATE_WINDOW
    for a in db.scalars(select(LighthouseAudit).where(
            LighthouseAudit.submitted_url == url, LighthouseAudit.strategy == strategy, LighthouseAudit.engine == engine,
            LighthouseAudit.status.in_(["queued", "running"])).order_by(LighthouseAudit.created_at.desc())):
        created = a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo
        if created >= cutoff:
            return a
    return None


def create_and_queue(db: Session, url: str, strategy: str, engine: str, site_audit_id: int | None = None,
                     check_duplicate: bool = True) -> LighthouseAudit:
    """SSRF-check, de-duplicate, store and queue one audit. Raises SSRFValidationError."""
    clean = validate_url_shape(url)
    resolve_and_validate(clean)
    if check_duplicate and site_audit_id is None and (dup := find_recent_duplicate(db, clean, strategy, engine)):
        return dup
    a = LighthouseAudit(submitted_url=clean, strategy=strategy, engine=engine, status="queued", site_audit_id=site_audit_id)
    db.add(a)
    db.commit()
    submit(a.id, engine)
    return a


def submit(audit_id: int, engine: str) -> None:
    _pool(engine).submit(_run, audit_id)


def _run(audit_id: int) -> None:
    global _active
    with _lock:
        _active += 1
    try:
        execute(audit_id)
    except Exception:  # a worker must never die silently
        log.exception("Lighthouse audit %s crashed", audit_id)
    finally:
        with _lock:
            _active -= 1


def execute(audit_id: int) -> None:
    db = SessionLocal()
    try:
        a = db.get(LighthouseAudit, audit_id)
        if a is None:
            return
        a.status = "running"
        db.commit()
        try:  # again at run time: DNS may have changed since the request
            validated = resolve_and_validate(a.submitted_url)
        except SSRFValidationError as exc:
            return _fail(db, a, str(exc))

        engine_used, fallback_reason = a.engine, None
        try:
            if a.engine == "pagespeed":
                try:
                    result = _run_pagespeed(validated.url, a.strategy, a.id)
                except pagespeed.PageSpeedError as first:
                    if not get_settings().lighthouse_local_enabled:
                        raise
                    log.warning("PageSpeed Insights failed for Lighthouse audit %s (%s); falling back to local Lighthouse", a.id, first)
                    try:
                        result = _pool("lighthouse").submit(_run_local, validated, a.strategy, a.id).result()
                    except lighthouse.LighthouseError as second:
                        raise lighthouse.LighthouseError(f"PageSpeed Insights failed ({first}); local Lighthouse fallback also failed ({second}).") from second
                    engine_used = "lighthouse"
                    fallback_reason = f"PageSpeed Insights failed ({first}); automatically fell back to the local Lighthouse engine for this result."
            else:
                result = _run_local(validated, a.strategy, a.id)
        except ENGINE_ERRORS as exc:
            return _fail(db, a, str(exc))
        except Exception:
            log.exception("Unexpected error running Lighthouse audit %s", a.id)
            return _fail(db, a, "An unexpected internal error occurred while running the audit.")

        normalized = result["normalized"]
        scores = lighthouse_report.extract_scores(normalized)
        a.final_url = normalized.get("final_url") or a.submitted_url
        a.performance_score, a.accessibility_score = scores["performance"], scores["accessibility"]
        a.best_practices_score, a.seo_score = scores["best_practices"], scores["seo"]
        a.metrics, a.report = normalized.get("metrics", {}), normalized
        a.raw_json_path, a.html_report_path, a.html_report_is_original = result.get("json_path"), result.get("html_path"), result["html_is_original"]
        a.engine_used, a.fallback_reason = engine_used, fallback_reason
        a.status, a.completed_at = "completed", _now()
        db.commit()
    finally:
        db.close()


def _fail(db: Session, a: LighthouseAudit, message: str) -> None:
    a.status, a.error_message, a.completed_at = "failed", message, _now()
    db.commit()


def _run_pagespeed(url: str, strategy: str, audit_id: int) -> dict[str, Any]:
    s = get_settings()
    if not s.lighthouse_pagespeed_configured:
        raise pagespeed.PageSpeedError("The PageSpeed Insights engine is not configured. Set PAGESPEED_API_KEY (and "
                                       "LIGHTHOUSE_PAGESPEED_ENABLED=true), or select the local Lighthouse engine instead.")
    data = pagespeed.fetch(url, strategy, timeout=s.lighthouse_timeout_seconds)
    normalized = lighthouse_report.normalize_report(data["lighthouseResult"], field_data=data.get("loadingExperience"),
                                                    origin_field_data=data.get("originLoadingExperience"))
    json_path = s.lighthouse_reports_path / f"psi-{audit_id}-{uuid.uuid4().hex[:8]}.json"
    json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return {"normalized": normalized, "json_path": str(json_path), "html_path": None, "html_is_original": False}


def _run_local(validated: ValidatedURL, strategy: str, audit_id: int) -> dict[str, Any]:
    s = get_settings()
    if not s.lighthouse_local_enabled:
        raise lighthouse.LighthouseNotConfiguredError("The local Lighthouse engine is disabled (LIGHTHOUSE_LOCAL_ENABLED=false). "
                                                      "Select the PageSpeed Insights engine instead, or enable it in configuration.")
    out = lighthouse.run_audit(url=validated.url, strategy=strategy, timeout_seconds=s.lighthouse_timeout_seconds,
                               reports_dir=s.lighthouse_reports_path, audit_id=audit_id, validated=validated)
    return {"normalized": lighthouse_report.normalize_report(out["raw_json"]), "json_path": out["json_path"],
            "html_path": out["html_path"], "html_is_original": True}
