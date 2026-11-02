"""AI features on the backlink data: page snippets (what the quality scorer reads), per-business domain quality scores, and action outcome tracking.

Revision ID: 0020_backlink_ai
Revises: 0019_merge_heads
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0020_backlink_ai"
down_revision = "0019_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "snippet" not in {c["name"] for c in insp.get_columns("bi_pages")}:
        op.add_column("bi_pages", sa.Column("snippet", sa.String(600), nullable=True))
    from app.backlinks.models import ActionOutcome, BiDomainScore
    existing = set(insp.get_table_names())
    for model in (BiDomainScore, ActionOutcome):
        if model.__table__.name not in existing:
            model.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("action_outcomes")
    op.drop_table("bi_domain_scores")
    op.drop_column("bi_pages", "snippet")
