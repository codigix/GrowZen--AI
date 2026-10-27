"""Orchestrates audit execution: validation, concurrency limiting,
persistence, and status transitions.

Job execution model: audits run as asyncio tasks inside the same process,
gated by a semaphore that enforces ``MAX_CONCURRENT_AUDITS``. Every audit is
persisted to SQLite *before* execution starts (status ``queued``), so audit
history, report files and download links survive a server restart. Only the
in-memory "this task is scheduled to run" state is lost on restart -- any
audit still ``queued``/``running`` when the process starts is marked
``failed`` with an explanatory message rather than left stuck forever.

This asyncio-based worker is adequate for local/single-instance use. A
production deployment serving many concurrent users should replace this
with a real task queue (RQ/Celery + Redis) so jobs survive process restarts
and can be distributed across workers; the persistence layer (SQLite rows +
report files on disk) is already structured to support that migration
without changing the API surface.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.audit_engines import lighthouse as lighthouse_engine
from app.audit_engines import pagespeed as pagespeed_engine
from app.audit_engines.errors import AuditEngineError, EngineNotConfiguredError
from app.config import Settings
from app.database import get_sessionmaker
from app.models.audit import Audit, AuditStatus
from app.security.url_validation import SSRFValidationError, resolve_and_validate, validate_url_shape
from app.services import report_service

logger = logging.getLogger("lighthouse_app.audit_service")

_DUPLICATE_WINDOW_SECONDS = 120


@dataclass
class _EngineState:
    semaphore: asyncio.Semaphore
    active_count: int = 0


class AuditManager:
    """Owns the concurrency semaphore and in-flight task bookkeeping."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Separate semaphores per engine: local Lighthouse spawns a real
        # Chrome process per audit (CPU/RAM bound), while PageSpeed Insights
        # just makes an HTTP call to Google's infrastructure and waits, so it
        # can run with much higher concurrency without local resource
        # contention. This also means a large PageSpeed-engine site audit no
        # longer queues up behind the same tight limit as local Lighthouse.
        self._lighthouse_semaphore = asyncio.Semaphore(settings.max_concurrent_audits)
        self._pagespeed_semaphore = asyncio.Semaphore(settings.max_concurrent_pagespeed_audits)
        self._active_count = 0
        self._tasks: set[asyncio.Task] = set()

    @property
    def active_count(self) -> int:
        return self._active_count

    def _semaphore_for(self, engine: str) -> asyncio.Semaphore:
        return self._pagespeed_semaphore if engine == "pagespeed" else self._lighthouse_semaphore

    def recover_interrupted_audits(self) -> None:
        """Mark any audit left in a non-terminal state (e.g. from a crash or
        restart) as failed, since no in-memory task will resume it."""
        db = get_sessionmaker()()
        try:
            stuck = (
                db.query(Audit)
                .filter(Audit.status.in_([AuditStatus.QUEUED.value, AuditStatus.RUNNING.value]))
                .all()
            )
            for audit in stuck:
                audit.status = AuditStatus.FAILED.value
                audit.error_message = "Interrupted by a server restart before completion."
                audit.completed_at = datetime.now(timezone.utc)
            db.commit()
            if stuck:
                logger.warning("Recovered %d interrupted audit(s) as failed", len(stuck))
        finally:
            db.close()

    def find_recent_duplicate(self, db: Session, url: str, strategy: str, engine: str) -> Audit | None:
        cutoff = datetime.now(timezone.utc).timestamp() - _DUPLICATE_WINDOW_SECONDS
        candidates = (
            db.query(Audit)
            .filter(
                Audit.submitted_url == url,
                Audit.strategy == strategy,
                Audit.engine == engine,
                Audit.status.in_([AuditStatus.QUEUED.value, AuditStatus.RUNNING.value]),
            )
            .order_by(Audit.created_at.desc())
            .all()
        )
        for candidate in candidates:
            # SQLite does not reliably round-trip tzinfo, so a value read
            # back may be naive even though it was always written in UTC;
            # normalize before comparing against a UTC-based cutoff.
            created_at = candidate.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            if created_at.timestamp() >= cutoff:
                return candidate
        return None

    def submit(self, audit_id: str, engine: str) -> None:
        task = asyncio.create_task(self._run(audit_id, engine))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def create_and_queue(
        self,
        db: Session,
        *,
        url: str,
        strategy: str,
        engine: str,
        site_audit_id: str | None = None,
        check_duplicate: bool = True,
    ) -> Audit:
        """Shared pipeline used by both single-page audit creation and each
        page of a site-wide audit: SSRF-validate, dedupe, persist, and
        schedule the background task."""
        clean_url = validate_url_shape(url)
        await asyncio.to_thread(resolve_and_validate, clean_url)

        if check_duplicate and site_audit_id is None:
            duplicate = self.find_recent_duplicate(db, clean_url, strategy, engine)
            if duplicate is not None:
                return duplicate

        audit = Audit(
            submitted_url=clean_url,
            strategy=strategy,
            engine=engine,
            status=AuditStatus.QUEUED.value,
            site_audit_id=site_audit_id,
        )
        db.add(audit)
        db.commit()
        db.refresh(audit)

        self.submit(audit.id, engine)
        return audit

    async def _run(self, audit_id: str, engine: str) -> None:
        async with self._semaphore_for(engine):
            self._active_count += 1
            try:
                await self._execute(audit_id)
            finally:
                self._active_count -= 1

    async def _execute(self, audit_id: str) -> None:
        db = get_sessionmaker()()
        try:
            audit = db.get(Audit, audit_id)
            if audit is None:
                return
            audit.status = AuditStatus.RUNNING.value
            db.commit()

            url = audit.submitted_url
            strategy = audit.strategy
            engine = audit.engine

            try:
                validated = resolve_and_validate(url)
            except SSRFValidationError as exc:
                self._fail(db, audit, str(exc))
                return

            engine_used = engine
            fallback_reason: str | None = None

            try:
                if engine == "pagespeed":
                    try:
                        result = await self._run_pagespeed(validated.url, strategy)
                    except AuditEngineError as primary_exc:
                        if not self.settings.local_lighthouse_enabled:
                            raise
                        logger.warning(
                            "PageSpeed Insights failed for audit %s (%s); falling back to local Lighthouse",
                            audit_id,
                            primary_exc,
                        )
                        try:
                            result = await self._run_lighthouse(validated, strategy, audit_id)
                        except AuditEngineError as fallback_exc:
                            raise AuditEngineError(
                                f"PageSpeed Insights failed ({primary_exc}); local Lighthouse "
                                f"fallback also failed ({fallback_exc})."
                            ) from fallback_exc
                        engine_used = "lighthouse"
                        fallback_reason = (
                            f"PageSpeed Insights failed ({primary_exc}); automatically fell "
                            "back to the local Lighthouse engine for this result."
                        )
                else:
                    result = await self._run_lighthouse(validated, strategy, audit_id)
            except AuditEngineError as exc:
                self._fail(db, audit, str(exc))
                return
            except Exception:
                logger.exception("Unexpected error running audit %s", audit_id)
                self._fail(db, audit, "An unexpected internal error occurred while running the audit.")
                return

            normalized = result["normalized"]
            scores = report_service.extract_scores(normalized)

            audit.final_url = normalized.get("final_url") or url
            audit.performance_score = scores["performance"]
            audit.accessibility_score = scores["accessibility"]
            audit.best_practices_score = scores["best_practices"]
            audit.seo_score = scores["seo"]
            audit.metrics_json = json.dumps(normalized.get("metrics", {}))
            audit.normalized_report_json = json.dumps(normalized)
            audit.raw_json_path = result.get("json_path")
            audit.html_report_path = result.get("html_path")
            audit.html_report_is_original = result.get("html_is_original", False)
            audit.engine_used = engine_used
            audit.fallback_reason = fallback_reason
            audit.status = AuditStatus.COMPLETED.value
            audit.completed_at = datetime.now(timezone.utc)
            db.commit()
        finally:
            db.close()

    def _fail(self, db: Session, audit: Audit, message: str) -> None:
        audit.status = AuditStatus.FAILED.value
        audit.error_message = message
        audit.completed_at = datetime.now(timezone.utc)
        db.commit()

    async def _run_pagespeed(self, url: str, strategy: str) -> dict:
        if not self.settings.pagespeed_configured:
            raise EngineNotConfiguredError(
                "The PageSpeed Insights engine is not configured. Set "
                "PAGESPEED_API_KEY (and PAGESPEED_ENABLED=true) in the "
                "environment, or select the local Lighthouse engine instead."
            )
        data = await pagespeed_engine.run_pagespeed_audit(
            url=url,
            strategy=strategy,
            api_key=self.settings.pagespeed_api_key,
            timeout_seconds=self.settings.audit_timeout_seconds,
        )
        lighthouse_result = data["lighthouseResult"]
        normalized = report_service.normalize_report(
            lighthouse_result,
            field_data=data.get("loadingExperience"),
            origin_field_data=data.get("originLoadingExperience"),
        )
        json_path = self.settings.reports_path / f"psi-{int(time.time()*1000)}.json"
        json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return {
            "normalized": normalized,
            "json_path": str(json_path),
            "html_path": None,
            "html_is_original": False,
        }

    async def _run_lighthouse(self, validated, strategy: str, audit_id: str) -> dict:
        if not self.settings.local_lighthouse_enabled:
            raise EngineNotConfiguredError(
                "The local Lighthouse engine is disabled "
                "(LOCAL_LIGHTHOUSE_ENABLED=false). Select the PageSpeed "
                "Insights engine instead, or enable it in configuration."
            )
        result = await lighthouse_engine.run_lighthouse_audit(
            url=validated.url,
            strategy=strategy,
            timeout_seconds=self.settings.audit_timeout_seconds,
            reports_dir=self.settings.reports_path,
            audit_id=audit_id,
            validated=validated,
        )
        normalized = report_service.normalize_report(result["raw_json"])
        return {
            "normalized": normalized,
            "json_path": result["json_path"],
            "html_path": result["html_path"],
            "html_is_original": True,
        }


def load_normalized_report(audit: Audit) -> dict | None:
    if not audit.normalized_report_json:
        return None
    return json.loads(audit.normalized_report_json)
