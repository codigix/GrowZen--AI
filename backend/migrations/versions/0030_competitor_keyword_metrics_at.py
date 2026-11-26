"""When a competitor keyword's difficulty was last looked up, so a looked-up keyword is not asked for again. Additive only.

Revision ID: 0030_competitor_keyword_metrics_at
Revises: 0029_keyword_mapping_status
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0030_competitor_keyword_metrics_at"
down_revision = "0029_keyword_mapping_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("competitor_keywords")}  # the app may have added it at start-up
    if "metrics_at" not in cols:
        op.add_column("competitor_keywords", sa.Column("metrics_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("competitor_keywords", "metrics_at")
