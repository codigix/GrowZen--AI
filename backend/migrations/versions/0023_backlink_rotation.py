"""Backlink bot rotation: frontier rows remember the business that queued them, and the rotation's position is stored.

Revision ID: 0023_backlink_rotation
Revises: 0022_site_publishing_methods
Create Date: 2026-11-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0023_backlink_rotation"
down_revision = "0022_site_publishing_methods"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "business_id" not in {c["name"] for c in insp.get_columns("bi_frontier")}:
        with op.batch_alter_table("bi_frontier") as t:  # batch mode: SQLite cannot add a foreign key in place
            t.add_column(sa.Column("business_id", sa.Integer(), nullable=True))
            t.create_foreign_key("fk_bi_frontier_business_id", "businesses", ["business_id"], ["id"], ondelete="SET NULL")
            t.create_index("ix_bi_frontier_business_id", ["business_id"])
    if "bi_rotation_state" not in insp.get_table_names():
        from app.backlinks.models import BiRotationState
        BiRotationState.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("bi_rotation_state")
    with op.batch_alter_table("bi_frontier") as t:
        t.drop_index("ix_bi_frontier_business_id")
        t.drop_constraint("fk_bi_frontier_business_id", type_="foreignkey")
        t.drop_column("business_id")
