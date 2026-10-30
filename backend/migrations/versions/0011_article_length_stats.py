"""Articles remember the chosen length and how long each generation step took.

Revision ID: 0011_article_length_stats
Revises: 0010_article_progress
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0011_article_length_stats"
down_revision = "0010_article_progress"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("articles")}  # 0001 builds from the models
    if "length" not in columns:
        op.add_column("articles", sa.Column("length", sa.String(10), nullable=True))
    if "stats" not in columns:
        op.add_column("articles", sa.Column("stats", sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("articles", "stats")
    op.drop_column("articles", "length")
