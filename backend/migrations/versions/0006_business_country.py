"""Business.country: the ISO country code (IN, OM, AE, US…) that decides how Google is searched, how phones
and addresses are checked and which listing sites matter. Existing businesses were all treated as India.

Revision ID: 0006_business_country
Revises: 0005_gbp_status
Create Date: 2026-10-28
"""
import sqlalchemy as sa
from alembic import op

revision = "0006_business_country"
down_revision = "0005_gbp_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}  # 0001 builds from the models
    if "country" not in columns:
        op.add_column("businesses", sa.Column("country", sa.String(2), nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "country")
