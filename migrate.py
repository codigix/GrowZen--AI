
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse, unquote

import psycopg2
from psycopg2 import sql
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

# Source SQLite database
SQLITE_PATH = r"C:\\Users\\User\\Desktop\\GrowZen--AI\\backend\\seo_platform_dev.db"

# Destination PostgreSQL database, parsed from DATABASE_URL in .env
_database_url = os.environ["DATABASE_URL"]
_parsed = urlparse(_database_url)
PG_CONFIG = {
    "host": _parsed.hostname,
    "port": _parsed.port,
    "database": _parsed.path.lstrip("/"),
    "user": _parsed.username,
    "password": unquote(_parsed.password) if _parsed.password else None,
}


def map_type(sqlite_type):
    """Convert common SQLite column types to PostgreSQL types."""
    t = (sqlite_type or "").upper()

    if "INT" in t:
        return "BIGINT"
    if any(x in t for x in ("CHAR", "CLOB", "TEXT")):
        return "TEXT"
    if "BLOB" in t:
        return "BYTEA"
    if any(x in t for x in ("REAL", "FLOA", "DOUB")):
        return "DOUBLE PRECISION"
    if "DECIMAL" in t or "NUMERIC" in t:
        return "NUMERIC"
    if "BOOL" in t:
        return "BOOLEAN"
    if "DATE" in t or "TIME" in t:
        return "TEXT"  # Preserve original values initially

    return "TEXT"


def get_pg_column_types(cur, table):
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = %s
        """,
        (table,),
    )
    return {name: data_type for name, data_type in cur.fetchall()}


def coerce_value(value, pg_type):
    if value is None:
        return None
    if pg_type == "boolean" and isinstance(value, int):
        return bool(value)
    return value


def migrate():
    source = sqlite3.connect(SQLITE_PATH)
    source.row_factory = sqlite3.Row

    target = psycopg2.connect(**PG_CONFIG)

    try:
        with target:
            with target.cursor() as cur:
                tables = source.execute("""
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                    AND name NOT LIKE 'sqlite_%'
                """).fetchall()

                for table_row in tables:
                    table = table_row["name"]
                    columns = source.execute(
                        f'PRAGMA table_info("{table}")'
                    ).fetchall()

                    if not columns:
                        continue

                    col_defs = []
                    pk_cols = [col["name"] for col in columns if col["pk"]]
                    for col in columns:
                        col_name = col["name"]
                        col_type = map_type(col["type"])

                        definition = sql.SQL("{} {}").format(
                            sql.Identifier(col_name),
                            sql.SQL(col_type)
                        )

                        if len(pk_cols) == 1 and col_name == pk_cols[0]:
                            definition += sql.SQL(" PRIMARY KEY")

                        col_defs.append(definition)

                    if len(pk_cols) > 1:
                        col_defs.append(
                            sql.SQL("PRIMARY KEY ({})").format(
                                sql.SQL(", ").join(
                                    sql.Identifier(name) for name in pk_cols
                                )
                            )
                        )

                    cur.execute(
                        sql.SQL("CREATE TABLE IF NOT EXISTS {} ({})").format(
                            sql.Identifier(table),
                            sql.SQL(", ").join(col_defs)
                        )
                    )

                    column_names = [col["name"] for col in columns]
                    quoted_columns = sql.SQL(", ").join(
                        sql.Identifier(name) for name in column_names
                    )
                    pg_types = get_pg_column_types(cur, table)

                    rows = source.execute(
                        f'SELECT * FROM "{table}"'
                    ).fetchall()

                    if rows:
                        insert_query = sql.SQL(
                            "INSERT INTO {} ({}) VALUES ({}) "
                            "ON CONFLICT DO NOTHING"
                        ).format(
                            sql.Identifier(table),
                            quoted_columns,
                            sql.SQL(", ").join(
                                sql.Placeholder() for _ in column_names
                            )
                        )

                        for row in rows:
                            cur.execute(
                                insert_query,
                                tuple(
                                    coerce_value(row[name], pg_types.get(name))
                                    for name in column_names
                                )
                            )

                    print(f"Migrated table: {table} ({len(rows)} rows)")

        print("Migration completed!")

    finally:
        source.close()
        target.close()


if __name__ == "__main__":
    migrate()
