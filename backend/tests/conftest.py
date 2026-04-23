"""Shared pytest fixtures: in-memory SQLite, fresh engine per test, TestClient."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

# Ensure config validators don't blow up in tests with a short key.
os.environ.setdefault("RD_ENVIRONMENT", "dev")
os.environ.setdefault("RD_SECRET_KEY", "test-secret-key-that-is-sufficiently-long-xx")

from app import db as db_module  # noqa: E402
from app.deps import get_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.security import hash_password  # noqa: E402


@pytest.fixture()
def engine():
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(eng)
    # Point the app's module-level engine at our in-memory one so any code path
    # that grabs `db_module.engine` directly (e.g. bootstrap) uses it too.
    original = db_module.engine
    db_module.engine = eng
    try:
        yield eng
    finally:
        db_module.engine = original
        eng.dispose()


@pytest.fixture()
def session(engine) -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture()
def app(engine):
    application = create_app()

    def _override_session() -> Iterator[Session]:
        with Session(engine) as s:
            yield s

    application.dependency_overrides[get_session] = _override_session
    yield application
    application.dependency_overrides.clear()


@pytest.fixture()
def client(app) -> Iterator[TestClient]:
    # The in-process rate limiter keeps state in a module-level dict; flush
    # it at the top of every test so suites that fire /login or /join in
    # quick succession don't trip the 429 threshold.
    from app.services.rate_limit import reset_for_tests
    reset_for_tests()
    with TestClient(app) as c:
        yield c


# ─── User/auth helpers ───

@pytest.fixture()
def make_user(session):
    def _make(
        username: str = "alice",
        password: str = "correct-horse-battery",
        role: UserRole = UserRole.USER,
        is_active: bool = True,
    ) -> User:
        u = User(
            username=username,
            password_hash=hash_password(password),
            role=role,
            is_active=is_active,
        )
        session.add(u)
        session.commit()
        session.refresh(u)
        return u
    return _make


@pytest.fixture()
def admin_user(make_user):
    return make_user(username="admin", password="admin-pass-1234", role=UserRole.ADMIN)


@pytest.fixture()
def admin_token(client, admin_user) -> str:
    r = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin-pass-1234"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture()
def auth_headers(admin_token) -> dict[str, str]:
    return {"Authorization": f"Bearer {admin_token}"}
