"""Per-project settings for automatic competitor analysis. Additive only.

Revision ID: 0028_competitor_config
Revises: 0027_competitor_runs
Create Date: 2026-11-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0028_competitor_config"
down_revision = "0027_competitor_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}  # the app may have added it at start-up
    if "competitor_config" not in cols:
        op.add_column("businesses", sa.Column("competitor_config", sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "competitor_config")
