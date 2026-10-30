"""Articles cover all the selected keywords together: keywords + rising_keywords replace the single `rising` flag.

The articles table was added one revision earlier, so it is rebuilt instead of altered.

Revision ID: 0007_article_keywords
Revises: 0006_articles
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

from app.models import Article

revision = "0007_article_keywords"
down_revision = "0006_articles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "articles" in inspector.get_table_names():
        if "keywords" in {c["name"] for c in inspector.get_columns("articles")}:
            return
        op.drop_table("articles")
    Article.__table__.create(bind=bind)


def downgrade() -> None:
    pass
