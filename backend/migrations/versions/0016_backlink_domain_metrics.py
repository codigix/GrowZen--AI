"""Provider domain metrics (rank, spam score, country, category) on bi_domains, and per-business domain reviews (whitelist / disavow / removal).

Revision ID: 0016_backlink_domain_metrics
Revises: 0015_backlink_intelligence
Create Date: 2026-10-30
"""
import sqlalchemy as sa
from alembic import op

revision = "0016_backlink_domain_metrics"
down_revision = "0015_backlink_intelligence"
branch_labels = None
depends_on = None

COLUMNS = [("provider_rank", sa.Integer()), ("spam_score", sa.Integer()), ("country", sa.String(8)), ("category", sa.String(60)),
           ("metrics_source", sa.String(40)), ("metrics_at", sa.DateTime(timezone=True))]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {c["name"] for c in insp.get_columns("bi_domains")}
    for name, type_ in COLUMNS:
        if name not in existing:
            op.add_column("bi_domains", sa.Column(name, type_, nullable=True))
    if "bi_domain_reviews" not in insp.get_table_names():
        from app.backlinks.models import BiDomainReview
        BiDomainReview.__table__.create(bind)


def downgrade() -> None:
    op.drop_table("bi_domain_reviews")
    for name, _ in reversed(COLUMNS):
        op.drop_column("bi_domains", name)
