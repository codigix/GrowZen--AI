"""A keyword's mapping status set by hand (optimization required, new page required, completed). Additive only.

Revision ID: 0029_keyword_mapping_status
Revises: 0028_competitor_config
Create Date: 2026-11-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0029_keyword_mapping_status"
down_revision = "0028_competitor_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("keywords")}  # the app may have added it at start-up
    if "mapping_status" not in cols:
        op.add_column("keywords", sa.Column("mapping_status", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("keywords", "mapping_status")
