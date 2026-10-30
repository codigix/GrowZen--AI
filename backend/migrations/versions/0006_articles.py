"""Articles: blog drafts generated from Google Trends keywords (AI Blog Studio).

Revision ID: 0006_articles
Revises: 0005_gbp_status
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

from app.models import Article

revision = "0006_articles"
down_revision = "0005_gbp_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "articles" not in set(sa.inspect(op.get_bind()).get_table_names()):  # 0001 builds from the models
        Article.__table__.create(bind=op.get_bind())


def downgrade() -> None:
    op.drop_table("articles")
