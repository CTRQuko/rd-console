"""Database engine + session lifecycle."""

from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings


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


def init_db() -> None:
    """Create tables if they don't exist. Called once on app startup."""
    # Ensure parent directory exists (the path is usually /data/... in Docker).
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    """FastAPI dependency yielding a short-lived DB session."""
    with Session(engine) as session:
        yield session
