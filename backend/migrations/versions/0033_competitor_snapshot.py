"""The figures of the last analysis kept on the competitor itself (Domain Authority, keywords, traffic and so on). Additive only.

Revision ID: 0033_competitor_snapshot
Revises: 0032_competitor_keyword_page_status
Create Date: 2026-11-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0033_competitor_snapshot"
down_revision = "0032_competitor_keyword_page_status"
branch_labels = None
depends_on = None

COLS = [("da", sa.Integer()), ("pa", sa.Integer()), ("spam_score", sa.Integer()), ("ref_domains", sa.Integer()), ("kw_count", sa.Integer()), ("traffic_est", sa.Integer()),
        ("top3", sa.Integer()), ("top10", sa.Integer()), ("avg_position", sa.Float()), ("analysis_status", sa.String(12)), ("analyzed_at", sa.DateTime(timezone=True))]


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("competitors")}  # the app may have added them at start-up
    for name, typ in COLS:
        if name not in have:
            op.add_column("competitors", sa.Column(name, typ, nullable=True))


def downgrade() -> None:
    for name, _t in reversed(COLS):
        op.drop_column("competitors", name)
