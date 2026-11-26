"""Whether the page a competitor keyword ranks with still exists (its HTTP status) and when that was checked. Additive only.

Revision ID: 0032_competitor_keyword_page_status
Revises: 0031_competitor_keyword_kd
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0032_competitor_keyword_page_status"
down_revision = "0031_competitor_keyword_kd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("competitor_keywords")}  # the app may have added them at start-up
    if "page_status" not in cols:
        op.add_column("competitor_keywords", sa.Column("page_status", sa.Integer(), nullable=True))
    if "page_checked_at" not in cols:
        op.add_column("competitor_keywords", sa.Column("page_checked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("competitor_keywords", "page_checked_at")
    op.drop_column("competitor_keywords", "page_status")
