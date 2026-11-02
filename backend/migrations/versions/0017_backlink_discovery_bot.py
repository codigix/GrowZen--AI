"""Discovery bot: hop count on the URL frontier and per-business bot settings.

Revision ID: 0017_backlink_discovery_bot
Revises: 0016_backlink_domain_metrics
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0017_backlink_discovery_bot"
down_revision = "0016_backlink_domain_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "hop" not in {c["name"] for c in insp.get_columns("bi_frontier")}:
        op.add_column("bi_frontier", sa.Column("hop", sa.Integer(), nullable=True))
    if "bi_bot_config" not in insp.get_table_names():
        from app.backlinks.models import BiBotConfig
        BiBotConfig.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("bi_bot_config")
    op.drop_column("bi_frontier", "hop")
