"""Site Audit settings and Position Tracking targeting, saved per project.

Revision ID: 0026_audit_track_config
Revises: 0025_audit_workspace
Create Date: 2026-11-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0026_audit_track_config"
down_revision = "0025_audit_workspace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}  # the app may have added them at start-up
    for name in ("audit_config", "track_config"):
        if name not in cols:
            op.add_column("businesses", sa.Column(name, sa.JSON, nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "track_config")
    op.drop_column("businesses", "audit_config")
