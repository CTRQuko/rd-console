"""Database engine + session lifecycle.

Light-touch migrations live here too. We don't use Alembic — for the
size of this project the extra machinery isn't worth it — so schema
additions that are *strictly additive* (new table, new column with a
NULL/False default) are performed by `_apply_additive_migrations()` on
startup. Anything non-trivial (rename, type change, drop) would still
need a one-off script; the function below reports what it did in the
logs so those cases are visible.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

log = logging.getLogger("rd_console.db")


def _build_sqlite_url(path: str) -> str:
    # SQLModel/SQLAlchemy accepts a POSIX-style URL even on Windows.
    # Keep the driver-less form so pool_pre_ping works as expected.
    return f"sqlite:///{path}"


settings = get_settings()
_DB_URL = _build_sqlite_url(str(settings.db_path))

# `check_same_thread=False` is required when the same engine is used across
# threads — FastAPI's default threadpool runs sync handlers on workers.
engine = create_engine(
    _DB_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)


# ─── Additive migrations ────────────────────────────────────────────────────
# Each entry: (table, column, SQL fragment used in ALTER TABLE). SQLite's
# ALTER TABLE ADD COLUMN is idempotent-enough for us when paired with a
# PRAGMA check — the combination never destroys data even if the entry is
# left in the list across restarts.
_ADDITIVE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # v3 device metadata
    ("devices", "note", "TEXT"),
    ("devices", "is_favorite", "BOOLEAN NOT NULL DEFAULT 0"),
    # v5: soft-delete for audit logs (PR C — /admin/api/logs DELETE)
    ("audit_logs", "deleted_at", "DATETIME"),
)


def _apply_additive_migrations() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in _ADDITIVE_COLUMNS:
            if table not in existing_tables:
                # Table doesn't exist yet — `create_all()` will make it fresh
                # with the current column set. Skip the ALTER.
                continue
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column in cols:
                continue
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN {column} {ddl}'))
            log.info("Added column %s.%s", table, column)


def init_db() -> None:
    """Create new tables, then apply additive column migrations."""
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    # Apply additive migrations BEFORE create_all() so we mutate the v2 shape
    # first; create_all() then only creates genuinely new tables (e.g. tags,
    # device_tags) and leaves existing ones alone.
    _apply_additive_migrations()
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a short-lived DB session."""
    with Session(engine) as session:
        yield session
