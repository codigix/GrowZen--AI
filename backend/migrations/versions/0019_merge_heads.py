"""Merge the two migration heads (the backlink chain and the older competitors/target-markets merge) into one.

Revision ID: 0019_merge_heads
Revises: 0018_remove_provider_imports, c4d6c3b31d40
Create Date: 2026-10-30
"""
revision = "0019_merge_heads"
down_revision = ("0018_remove_provider_imports", "c4d6c3b31d40")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
