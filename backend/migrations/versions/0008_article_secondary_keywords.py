"""Articles keep the primary keyword and the secondary keywords in separate fields.

The articles table is hours old and only holds drafts, so it is rebuilt instead of altered.

Revision ID: 0008_article_secondary_keywords
Revises: 0007_article_keywords
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

from app.models import Article

revision = "0008_article_secondary_keywords"
down_revision = "0007_article_keywords"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "articles" in inspector.get_table_names():
        if "secondary_keywords" in {c["name"] for c in inspector.get_columns("articles")}:
            return
        op.drop_table("articles")
    Article.__table__.create(bind=bind)


def downgrade() -> None:
    pass
