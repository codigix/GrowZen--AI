"""Competitors table (registered against a business) and audits.competitor_id, so a competitor
audit can be tied to a business and a specific registered competitor for later comparison.

Revision ID: 0006_competitors
Revises: 0005_gbp_status
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0006_competitors"
down_revision = "0005_gbp_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())  # 0001 builds from the models
    if "competitors" not in tables:
        op.create_table(
            "competitors",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("business_id", sa.Integer, sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("website", sa.String(500)),
            sa.Column("address", sa.String(500)),
            sa.Column("phone", sa.String(40)),
            sa.Column("rating", sa.Float),
            sa.Column("reviews", sa.Integer),
            sa.Column("maps_link", sa.String(500)),
            sa.Column("source", sa.String(20), nullable=False, server_default="google_places"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("business_id", "website"),
        )
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("audits")}
    if "competitor_id" not in columns:
        op.add_column("audits", sa.Column("competitor_id", sa.Integer, sa.ForeignKey("competitors.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("audits", "competitor_id")
    op.drop_table("competitors")
