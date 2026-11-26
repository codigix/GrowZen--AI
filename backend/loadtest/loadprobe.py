"""A background job and a recorder the multi-worker load test uses to count how many times, and in which process, work really ran. Importable by its short name because the server is started
from this folder; the recorder writes to its own small table on the test database (psycopg directly, so it never touches the application's connection pool)."""
import os
import time

import psycopg

_ready = False


def _url():
    return os.environ["LOAD_DB_URL"].replace("postgresql+psycopg://", "postgresql://")


def record(kind: str, key: str) -> None:
    global _ready
    with psycopg.connect(_url(), autocommit=True) as c:
        if not _ready:
            c.execute("create table if not exists load_probe (id serial primary key, kind text, key text, pid int, at timestamptz default now())")
            _ready = True
        c.execute("insert into load_probe (kind, key, pid) values (%s, %s, %s)", (kind, key, os.getpid()))


def probe(db, key):
    """A job that is slow (it waits for an outside service): it writes a line when it starts and one when it finishes."""
    record("start", key)
    time.sleep(float(os.environ.get("PROBE_SECONDS", "6")))
    record("finish", key)
