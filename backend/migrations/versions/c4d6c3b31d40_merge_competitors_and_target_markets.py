"""merge competitors and target_markets

Revision ID: c4d6c3b31d40
Revises: 0006_competitors, 0007_target_markets
Create Date: 2026-10-29 13:31:36.237800
"""
from alembic import op
import sqlalchemy as sa


revision = 'c4d6c3b31d40'
down_revision = ('0006_competitors', '0007_target_markets')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
