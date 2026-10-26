"""SQLAlchemy rows -> JSON-friendly dicts."""
from datetime import date, datetime
from typing import Any

from sqlalchemy import inspect

HIDDEN = {"refresh_token_enc"}


def row(obj: Any, exclude: set[str] | None = None) -> dict[str, Any] | None:
    if obj is None:
        return None
    out = {}
    for col in inspect(obj).mapper.column_attrs:
        if col.key in HIDDEN or (exclude and col.key in exclude):
            continue
        v = getattr(obj, col.key)
        out[col.key] = v.isoformat() if isinstance(v, (datetime, date)) else v
    return out


def rows(objs: Any, exclude: set[str] | None = None) -> list[dict[str, Any]]:
    return [row(o, exclude) for o in objs]
