"""Publishing methods beyond WordPress: integration settings (config) and posts GrowZen schedules itself.

Revision ID: 0022_site_publishing_methods
Revises: 0021_render_and_competitor_watch
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0022_site_publishing_methods"
down_revision = "0021_render_and_competitor_watch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "config" not in {c["name"] for c in insp.get_columns("site_integrations")}:
        op.add_column("site_integrations", sa.Column("config", sa.JSON(), nullable=True))
    if "scheduled_posts" not in insp.get_table_names():
        from app.models import ScheduledPost
        ScheduledPost.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("scheduled_posts")
    op.drop_column("site_integrations", "config")
