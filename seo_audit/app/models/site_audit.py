"""SQLAlchemy model for a site-wide audit: a batch of individual page
audits discovered from a site's sitemap and run as a group."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SiteAudit(Base):
    __tablename__ = "site_audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    base_url: Mapped[str] = mapped_column(String(2048))
    strategy: Mapped[str] = mapped_column(String(16))
    engine: Mapped[str] = mapped_column(String(16))
    max_pages: Mapped[int] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    page_count: Mapped[int] = mapped_column(Integer, default=0)
    discovery_error: Mapped[str | None] = mapped_column(Text, nullable=True)
