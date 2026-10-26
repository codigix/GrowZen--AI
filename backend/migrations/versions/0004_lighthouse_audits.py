"""Lighthouse audits (merged from the standalone seo_audit tool): single-page runs and sitemap batches.

Revision ID: 0004_lighthouse_audits
Revises: 0003_users
Create Date: 2026-10-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_lighthouse_audits"
down_revision = "0003_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())  # 0001 builds from the models
    if "lighthouse_site_audits" not in tables:
        op.create_table(
            "lighthouse_site_audits",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("base_url", sa.String(2048), nullable=False),
            sa.Column("strategy", sa.String(16), nullable=False),
            sa.Column("engine", sa.String(16), nullable=False),
            sa.Column("max_pages", sa.Integer, nullable=False),
            sa.Column("page_count", sa.Integer, nullable=False, server_default="0"),
            sa.Column("discovery_error", sa.Text),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "lighthouse_audits" not in tables:
        op.create_table(
            "lighthouse_audits",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("site_audit_id", sa.Integer, sa.ForeignKey("lighthouse_site_audits.id", ondelete="CASCADE"), index=True),
            sa.Column("submitted_url", sa.String(2048), nullable=False),
            sa.Column("final_url", sa.String(2048)),
            sa.Column("strategy", sa.String(16), nullable=False),
            sa.Column("engine", sa.String(16), nullable=False),
            sa.Column("engine_used", sa.String(16)),
            sa.Column("fallback_reason", sa.Text),
            sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
            sa.Column("completed_at", sa.DateTime(timezone=True)),
            sa.Column("performance_score", sa.Integer),
            sa.Column("accessibility_score", sa.Integer),
            sa.Column("best_practices_score", sa.Integer),
            sa.Column("seo_score", sa.Integer),
            sa.Column("metrics", sa.JSON),
            sa.Column("report", sa.JSON),
            sa.Column("raw_json_path", sa.String(1024)),
            sa.Column("html_report_path", sa.String(1024)),
            sa.Column("html_report_is_original", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("error_message", sa.Text),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("lighthouse_audits")
    op.drop_table("lighthouse_site_audits")
