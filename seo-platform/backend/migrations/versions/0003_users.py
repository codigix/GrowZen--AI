"""Own users for the standalone SEO platform login.

Revision ID: 0003_users
Revises: 0002_business_faqs
Create Date: 2026-10-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_users"
down_revision = "0002_business_faqs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "users" in sa.inspect(op.get_bind()).get_table_names():  # 0001 builds from the models
        return
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="editor"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("users")
