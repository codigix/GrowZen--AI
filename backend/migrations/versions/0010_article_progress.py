"""Articles show which part is being written while they are generated.

Revision ID: 0010_article_progress
Revises: 0009_article_topic
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0010_article_progress"
down_revision = "0009_article_topic"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "progress" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("articles")}:  # 0001 builds from the models
        op.add_column("articles", sa.Column("progress", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("articles", "progress")
