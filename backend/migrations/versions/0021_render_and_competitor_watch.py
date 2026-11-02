"""JavaScript page reading (opt-in per business) and the weekly competitor watch: settings, page state, change events and reports.

Revision ID: 0021_render_and_competitor_watch
Revises: 0020_backlink_ai
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0021_render_and_competitor_watch"
down_revision = "0020_backlink_ai"
branch_labels = None
depends_on = None

COLUMNS = [("render_js", sa.Boolean()), ("watch_enabled", sa.Boolean()), ("watch_last_run_at", sa.DateTime(timezone=True)), ("watch_running", sa.Boolean()),
           ("watch_started_at", sa.DateTime(timezone=True))]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    have = {c["name"] for c in insp.get_columns("bi_bot_config")}
    for name, type_ in COLUMNS:
        if name not in have:
            op.add_column("bi_bot_config", sa.Column(name, type_, nullable=True))
    from app.backlinks.models import WatchEvent, WatchPage, WatchReport
    existing = set(insp.get_table_names())
    for model in (WatchPage, WatchEvent, WatchReport):
        if model.__table__.name not in existing:
            model.__table__.create(bind)


def downgrade() -> None:
    for t in ("competitor_watch_reports", "competitor_watch_events", "competitor_watch_pages"):
        op.drop_table(t)
    for name, _ in reversed(COLUMNS):
        op.drop_column("bi_bot_config", name)
