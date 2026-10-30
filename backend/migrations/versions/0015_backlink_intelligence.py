"""Backlink Intelligence tables: link graph, history, provenance, provider imports, URL frontier, crawl attempts.

Revision ID: 0015_backlink_intelligence
Revises: 0014_rank_log_detail
Create Date: 2026-10-30
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_backlink_intelligence"
down_revision = "0014_rank_log_detail"
branch_labels = None
depends_on = None


def _tables():
    from app.backlinks import models  # noqa: F401  (registers the tables)
    from app.db import Base
    names = {"bi_domains", "bi_pages", "bi_tracked_targets", "backlinks", "backlink_provenance", "backlink_observations", "backlink_events",
             "backlink_provider_imports", "bi_frontier", "bi_crawl_attempts"}
    return [t for t in Base.metadata.sorted_tables if t.name in names]


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())  # 0001 may already have built them from the models
    for t in _tables():
        if t.name not in existing:
            t.create(bind)


def downgrade() -> None:
    for t in reversed(_tables()):
        t.drop(op.get_bind(), checkfirst=True)
