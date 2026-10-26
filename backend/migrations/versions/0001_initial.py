"""Initial schema: every table of the SEO platform.

The first migration builds the schema straight from the models (they are the single source of
truth at version 1). Later changes go in new revisions: `alembic revision --autogenerate -m "..."`.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-26
"""
from alembic import op

from app import models  # noqa: F401
from app.db import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
