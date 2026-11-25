"""Competitor analysis history, discovery source / direct-indirect flag, and the provider usage log. Additive only.

Revision ID: 0027_competitor_runs
Revises: 0026_audit_track_config
Create Date: 2026-11-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0027_competitor_runs"
down_revision = "0026_audit_track_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("competitors")}
    for name, typ in (("domain", sa.String(255)), ("kind", sa.String(10)), ("discovery", sa.JSON)):
        if name not in cols:
            op.add_column("competitors", sa.Column(name, typ, nullable=True))
    if "ix_competitors_domain" not in {i["name"] for i in insp.get_indexes("competitors")}:
        op.create_index("ix_competitors_domain", "competitors", ["domain"])
    tables = set(insp.get_table_names())
    if "competitor_analysis_runs" not in tables:
        op.create_table("competitor_analysis_runs",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False),
            sa.Column("domain", sa.String(255), index=True, nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("trigger", sa.String(10), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
            sa.Column("parts", sa.JSON), sa.Column("missing", sa.JSON), sa.Column("error", sa.Text), sa.Column("snapshot", sa.JSON))
    if "api_usage_log" not in tables:
        op.create_table("api_usage_log",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), index=True),
            sa.Column("provider", sa.String(30), index=True, nullable=False),
            sa.Column("target", sa.String(255)), sa.Column("ok", sa.Boolean, nullable=False), sa.Column("detail", sa.String(300)),
            sa.Column("cost", sa.Float), sa.Column("at", sa.DateTime(timezone=True), index=True, nullable=False))


def downgrade() -> None:
    op.drop_table("api_usage_log")
    op.drop_table("competitor_analysis_runs")
    op.drop_index("ix_competitors_domain", "competitors")
    for name in ("discovery", "kind", "domain"):
        op.drop_column("competitors", name)
