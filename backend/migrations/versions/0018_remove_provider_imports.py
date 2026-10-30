"""Remove the third-party provider import log: backlinks now come only from our own discovery bot (and manual imports).

The provider metric columns added to bi_domains in 0016 are left in place as unused nullable columns; dropping columns is not worth the risk.

Revision ID: 0018_remove_provider_imports
Revises: 0017_backlink_discovery_bot
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0018_remove_provider_imports"
down_revision = "0017_backlink_discovery_bot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "backlink_provider_imports" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("backlink_provider_imports")


def downgrade() -> None:
    pass  # the provider integration no longer exists; there is nothing to restore
