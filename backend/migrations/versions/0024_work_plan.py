"""Website research profile, weekly work items and weekly/monthly reports. Also merges the two 0023 heads.

Revision ID: 0024_work_plan
Revises: 0023_backlink_finder, 0023_backlink_rotation
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0024_work_plan"
down_revision = ("0023_backlink_finder", "0023_backlink_rotation")
branch_labels = None
depends_on = None


def _ts():
    return [sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())]


def upgrade() -> None:
    have = set(sa.inspect(op.get_bind()).get_table_names())  # the app also creates missing tables at start-up
    if "site_profiles" not in have:
        op.create_table(
            "site_profiles", sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, unique=True, index=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
            sa.Column("stack", sa.JSON), sa.Column("site_checks", sa.JSON), sa.Column("metadata_audit", sa.JSON), sa.Column("suggested_metadata", sa.JSON),
            sa.Column("recommendations", sa.JSON), sa.Column("summary", sa.Text), sa.Column("error", sa.Text), sa.Column("scanned_at", sa.DateTime(timezone=True)), *_ts())
    if "work_items" not in have:
        op.create_table(
            "work_items", sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("week_start", sa.Date, nullable=False, index=True), sa.Column("key", sa.String(200), nullable=False, index=True),
            sa.Column("area", sa.String(30), nullable=False), sa.Column("title", sa.String(500), nullable=False), sa.Column("detail", sa.JSON),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"), sa.Column("priority", sa.Integer, nullable=False, server_default="3"),
            sa.Column("impact", sa.String(10), nullable=False, server_default="Medium"), sa.Column("status", sa.String(20), nullable=False, server_default="todo"),
            sa.Column("assignee", sa.String(120)), sa.Column("due_date", sa.Date), sa.Column("note", sa.Text), sa.Column("carried_from", sa.Integer),
            sa.Column("carry_count", sa.Integer, nullable=False, server_default="0"), sa.Column("completed_at", sa.DateTime(timezone=True)),
            sa.Column("verified", sa.Boolean, nullable=False, server_default=sa.false()), *_ts())
    if "weekly_reports" not in have:
        op.create_table(
            "weekly_reports", sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("period", sa.String(10), nullable=False), sa.Column("period_start", sa.Date, nullable=False, index=True), sa.Column("period_end", sa.Date, nullable=False),
            sa.Column("data", sa.JSON), sa.Column("narrative", sa.Text), sa.Column("final", sa.Boolean, nullable=False, server_default=sa.false()), *_ts(),
            sa.UniqueConstraint("business_id", "period", "period_start"))


def downgrade() -> None:
    op.drop_table("weekly_reports")
    op.drop_table("work_items")
    op.drop_table("site_profiles")
