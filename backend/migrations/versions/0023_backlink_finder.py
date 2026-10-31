"""Backlink Finder: watch any domain, subdomain or exact URL and store the backlinks the crawler finds for it.

Revision ID: 0023_backlink_finder
Revises: 0022_site_publishing_methods
Create Date: 2026-10-31
"""
import sqlalchemy as sa
from alembic import op

revision = "0023_backlink_finder"
down_revision = "0022_site_publishing_methods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = insp.get_table_names()
    if "bi_finder_targets" not in existing:
        from app.backlinks.models import BacklinkFinderTarget
        BacklinkFinderTarget.__table__.create(bind)
    if "bi_finder_results" not in existing:
        from app.backlinks.models import BacklinkFinderResult
        BacklinkFinderResult.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("bi_finder_results")
    op.drop_table("bi_finder_targets")
