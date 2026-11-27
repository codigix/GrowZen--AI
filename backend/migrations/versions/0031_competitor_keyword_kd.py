"""The SEO difficulty read for a competitor keyword (from the real top 10 on Google) and when. Additive only.

Revision ID: 0031_competitor_keyword_kd
Revises: 0030_competitor_keyword_metrics_at
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0031_competitor_keyword_kd"
down_revision = "0030_competitor_keyword_metrics_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("competitor_keywords")}  # the app may have added them at start-up
    if "kd" not in cols:
        op.add_column("competitor_keywords", sa.Column("kd", sa.Integer(), nullable=True))
    if "kd_at" not in cols:
        op.add_column("competitor_keywords", sa.Column("kd_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("competitor_keywords", "kd_at")
    op.drop_column("competitor_keywords", "kd")
