"""Articles remember the trending topic they were started from.

Revision ID: 0009_article_topic
Revises: 0008_article_secondary_keywords
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0009_article_topic"
down_revision = "0008_article_secondary_keywords"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "topic" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("articles")}:  # 0001 builds from the models
        op.add_column("articles", sa.Column("topic", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("articles", "topic")
