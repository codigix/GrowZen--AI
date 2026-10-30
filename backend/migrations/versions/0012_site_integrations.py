"""Per-business website integration for publishing blog posts.

Revision ID: 0012_site_integrations
Revises: 0011_article_length_stats
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0012_site_integrations"
down_revision = "0011_article_length_stats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "site_integrations" in sa.inspect(op.get_bind()).get_table_names():  # 0001 builds from the models
        return
    op.create_table(
        "site_integrations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, unique=True, index=True),
        sa.Column("platform", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("method", sa.String(20)),
        sa.Column("base_url", sa.String(500)),
        sa.Column("username", sa.String(255)),
        sa.Column("secret_enc", sa.Text),
        sa.Column("detected", sa.JSON),
        sa.Column("status", sa.String(20), nullable=False, server_default="not_connected"),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("site_integrations")
