"""Keeps the database in step with the models without a migration run.

The live database was not built by this repo's migrations (its migration version is one this repo has never had),
so a new table or column added to the models would simply be missing and every page using it would fail. At start-up
this creates tables that don't exist and adds columns that don't, as nullable columns. It never drops, renames or
retypes anything: changes like that stay migrations. `drift()` reports what is still different, for diagnostics.
"""
import logging
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from ..db import Base

log = logging.getLogger("seo.schema")


def drift(engine: Engine) -> dict[str, Any]:
    """Tables and columns the models have that the database lacks."""
    insp = inspect(engine)
    have = set(insp.get_table_names())
    missing_tables, missing_columns = [], {}
    for table in Base.metadata.sorted_tables:
        if table.name not in have:
            missing_tables.append(table.name)
            continue
        cols = {c["name"] for c in insp.get_columns(table.name)}
        miss = [c.name for c in table.columns if c.name not in cols]
        if miss:
            missing_columns[table.name] = miss
    return {"missing_tables": missing_tables, "missing_columns": missing_columns}


def sync(engine: Engine) -> dict[str, Any]:
    """Create what is missing. Returns what was done."""
    found = drift(engine)
    done: dict[str, Any] = {"created_tables": [], "added_columns": []}
    for name in found["missing_tables"]:
        Base.metadata.tables[name].create(engine, checkfirst=True)
        done["created_tables"].append(name)
        log.warning("Created missing table %s", name)
    for table_name, cols in found["missing_columns"].items():
        table = Base.metadata.tables[table_name]
        for col_name in cols:
            col = table.columns[col_name]
            ddl = f'ALTER TABLE "{table_name}" ADD COLUMN "{col_name}" {col.type.compile(dialect=engine.dialect)}'
            with engine.begin() as conn:
                conn.execute(text(ddl))
            done["added_columns"].append(f"{table_name}.{col_name}")
            log.warning("Added missing column %s.%s", table_name, col_name)
    return done
