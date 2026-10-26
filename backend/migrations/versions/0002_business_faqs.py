"""Business FAQs (Q&A shown on the profile, website FAQ and FAQ schema).

Revision ID: 0002_business_faqs
Revises: 0001_initial
Create Date: 2026-10-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_business_faqs"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("businesses")}
    if "faqs" not in cols:  # 0001 builds from the models, so a fresh database already has it
        op.add_column("businesses", sa.Column("faqs", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("businesses", "faqs")
