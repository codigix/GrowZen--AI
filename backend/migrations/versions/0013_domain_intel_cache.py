"""Cache of Domain Overview data fetched from the paid data provider.

Revision ID: 0013_domain_intel_cache
Revises: 0012_site_integrations
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0013_domain_intel_cache"
down_revision = "0012_site_integrations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "domain_intel_cache" in sa.inspect(op.get_bind()).get_table_names():  # 0001 builds from the models
        return
    op.create_table(
        "domain_intel_cache",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("domain", sa.String(255), nullable=False, index=True),
        sa.Column("key", sa.String(80), nullable=False),
        sa.Column("tier", sa.String(10), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("domain", "key", "tier"),
    )


def downgrade() -> None:
    op.drop_table("domain_intel_cache")
