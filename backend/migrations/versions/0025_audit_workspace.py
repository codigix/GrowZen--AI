"""Tag website audits with the project they were run from, so one project's audit history never shows in another.

Revision ID: 0025_audit_workspace
Revises: 0024_work_plan
Create Date: 2026-11-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0025_audit_workspace"
down_revision = "0024_work_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("audits")}  # the app may have added it at start-up
    if "workspace_id" not in cols:
        op.add_column("audits", sa.Column("workspace_id", sa.Integer, nullable=True))
        op.create_index("ix_audits_workspace_id", "audits", ["workspace_id"])
    backfill(op.get_bind())


def backfill(conn) -> None:
    """Earlier scans of a project's own site belong to that project."""
    from urllib.parse import urlparse
    host = lambda u: urlparse(u if (u or "").startswith("http") else f"https://{u or ''}").netloc.lower().removeprefix("www.")  # noqa: E731
    owners = {host(w): i for i, w in conn.execute(sa.text("select id, website from businesses where website is not null")) if host(w)}
    for aid, target in conn.execute(sa.text("select id, target from audits where kind = 'website' and workspace_id is null")).fetchall():
        if host(target) in owners:
            conn.execute(sa.text("update audits set workspace_id = :b where id = :a"), {"b": owners[host(target)], "a": aid})


def downgrade() -> None:
    op.drop_index("ix_audits_workspace_id", "audits")
    op.drop_column("audits", "workspace_id")
