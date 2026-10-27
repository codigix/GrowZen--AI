"""SQLAlchemy engine/session setup and schema initialization.

Engine/session creation is lazy and derived from the *current* settings
(rather than bound once at import time) so tests can point the app at an
isolated, temporary database by setting environment variables before the
app is constructed.
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def _get_engine_for_url(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def get_engine() -> Engine:
    return _get_engine_for_url(get_settings().database_url)


def get_sessionmaker() -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def init_db() -> None:
    from app.models import audit, site_audit  # noqa: F401  (ensure models are registered)

    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations(engine)


def _apply_lightweight_migrations(engine: Engine) -> None:
    """Add any model columns missing from an existing (older) database file.

    This project intentionally avoids pulling in a full migration framework
    (e.g. Alembic) for this small app; instead, any column present on an ORM
    model but absent from its actual table is added via a plain ``ALTER
    TABLE ... ADD COLUMN``. Safe to run on every startup: it only adds
    columns, never drops or renames data. New tables are already handled by
    ``create_all`` above.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {col["name"] for col in inspector.get_columns(table_name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                col_type = column.type.compile(engine.dialect)
                conn.execute(text(f'ALTER TABLE {table_name} ADD COLUMN "{column.name}" {col_type}'))


def get_db():
    session_local = get_sessionmaker()
    db: Session = session_local()
    try:
        yield db
    finally:
        db.close()
