from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import sessionmaker

from .config import Settings
from .models import Base


def make_engine(url: str) -> Engine:
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


class Database:
    """Engine + session factory. Tables are created on start (create_all only adds what is missing)."""

    def __init__(self, settings: Settings):
        self.engine = make_engine(settings.database_url)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    def create_tables(self) -> None:
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self):
        with self._sessions.begin() as s:  # commits on success, rolls back on error
            yield s

    def dispose(self) -> None:
        self.engine.dispose()

