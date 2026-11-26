"""Database engine and session. PostgreSQL in production; any SQLAlchemy URL works for tests."""
from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


_settings = get_settings()
# PostgreSQL: give up after 10 s instead of waiting forever (an unreachable host would otherwise
# hang start-up before the server ever listens).
def connect_args(url: str, statement_timeout_seconds: int) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    # keepalives: a database reached through an SSH tunnel loses its connections whenever the tunnel restarts; without them a request on such a
    # dead connection waits minutes. With them the dead connection is noticed within about a minute and replaced.
    args: dict = {"connect_timeout": 10, "keepalives": 1, "keepalives_idle": 20, "keepalives_interval": 5, "keepalives_count": 3}
    if statement_timeout_seconds and statement_timeout_seconds > 0:
        args["options"] = f"-c statement_timeout={int(statement_timeout_seconds) * 1000}"
    return args


_connect_args = connect_args(_settings.database_url, _settings.db_statement_timeout_seconds)
# pool_pre_ping would cost one extra round trip to the database on every request; recycling idle connections after 5 minutes avoids stale ones instead.
_pool = {} if _settings.database_url.startswith("sqlite") else {"pool_recycle": 300, "pool_size": 10, "max_overflow": 20}
engine = create_engine(_settings.database_url, pool_pre_ping=False, connect_args=_connect_args, **_pool)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def release_connection(db: Session) -> None:
    """Give this session's pooled connection back before a slow call (Google, Apify, an AI provider, a website, Chrome).

    A session keeps its connection from its first statement until commit, rollback or close, so a handler that reads the database and then waits on an outside service
    would hold the connection for the whole wait. Everything the handler still needs must already be read: loaded attributes stay readable after this (the sessions keep
    `expire_on_commit=False`), but an attribute that was never loaded is read from the database again later, which takes a connection again.

    It only ends a transaction that has nothing unsaved. When the session holds unsaved changes it does nothing, because committing would save them earlier than the caller meant to.
    It never rolls back and never closes the session (rolling back would expire every loaded object, closing would detach them).
    """
    if db.new or db.dirty or db.deleted:
        return
    if db.in_transaction():
        db.commit()
