"""Rank log keeps the ranking page, the results Google returned and the SERP features.

Revision ID: 0014_rank_log_detail
Revises: 0013_domain_intel_cache
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0014_rank_log_detail"
down_revision = "0013_domain_intel_cache"
branch_labels = None
depends_on = None

COLUMNS = [("url", sa.String(500)), ("own_urls", sa.JSON), ("serp", sa.JSON), ("features", sa.JSON), ("own_features", sa.JSON)]


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("keyword_rank_log")}  # 0001 builds from the models
    for name, type_ in COLUMNS:
        if name not in existing:
            op.add_column("keyword_rank_log", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("keyword_rank_log", name)
