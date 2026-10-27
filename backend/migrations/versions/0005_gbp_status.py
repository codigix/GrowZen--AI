"""Business.gbp_status: the listing's live state from Google (open status, pending edits, links).

Revision ID: 0005_gbp_status
Revises: 0004_lighthouse_audits
Create Date: 2026-10-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0005_gbp_status"
down_revision = "0004_lighthouse_audits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}  # 0001 builds from the models
    if "gbp_status" not in columns:
        op.add_column("businesses", sa.Column("gbp_status", sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "gbp_status")
