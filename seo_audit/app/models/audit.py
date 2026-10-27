"""SQLAlchemy model for a persisted audit record."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Enum, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AuditStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AuditStrategy(str, enum.Enum):
    MOBILE = "mobile"
    DESKTOP = "desktop"


class AuditEngine(str, enum.Enum):
    PAGESPEED = "pagespeed"
    LIGHTHOUSE = "lighthouse"


class Audit(Base):
    __tablename__ = "audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    submitted_url: Mapped[str] = mapped_column(String(2048))
    final_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    strategy: Mapped[str] = mapped_column(String(16))
    engine: Mapped[str] = mapped_column(String(16))

    status: Mapped[str] = mapped_column(String(16), default=AuditStatus.QUEUED.value)

    # Set when this audit is one page of a site-wide audit batch.
    site_audit_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # The engine actually used to produce the result. Normally equal to
    # ``engine``, but differs when PageSpeed was requested, failed, and the
    # audit automatically fell back to the local Lighthouse engine.
    engine_used: Mapped[str | None] = mapped_column(String(16), nullable=True)
    fallback_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    performance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    accessibility_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_practices_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    seo_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    metrics_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_report_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_json_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    html_report_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    html_report_is_original: Mapped[bool] = mapped_column(default=False)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
