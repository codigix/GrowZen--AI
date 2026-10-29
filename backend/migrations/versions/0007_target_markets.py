"""Business.target_scope / target_countries / target_areas: whether the business serves a local area or
international markets, and which ones.

Revision ID: 0007_target_markets
Revises: 0006_business_country
Create Date: 2026-10-29
"""
import sqlalchemy as sa
from alembic import op

revision = "0007_target_markets"
down_revision = "0006_business_country"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}  # 0001 builds from the models
    if "target_scope" not in columns:
        op.add_column("businesses", sa.Column("target_scope", sa.String(15), nullable=True))
    if "target_countries" not in columns:
        op.add_column("businesses", sa.Column("target_countries", sa.JSON, nullable=True))
    if "target_areas" not in columns:
        op.add_column("businesses", sa.Column("target_areas", sa.JSON, nullable=True))


def downgrade() -> None:
    for c in ("target_areas", "target_countries", "target_scope"):
        op.drop_column("businesses", c)
