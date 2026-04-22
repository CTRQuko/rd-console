"""Auth flow tests — login happy/edge paths, token validation."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlmodel import select

from app.models.audit_log import AuditAction, AuditLog
from app.models.user import UserRole
from app.security import create_access_token, decode_access_token


def test_login_happy_path_returns_jwt(client, admin_user):
    r = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin-pass-1234"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    claims = decode_access_token(body["access_token"])
    assert claims is not None
    assert int(claims["sub"]) == admin_user.id
    assert claims.get("role") == UserRole.ADMIN.value


def test_login_wrong_password_logs_failure_and_401(client, admin_user, session):
    r = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "WRONG"},
    )
    assert r.status_code == 401
    # The audit log must record the failed attempt.
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.LOGIN_FAILED)
    ).all()
    assert len(rows) == 1
    assert "admin" in (rows[0].payload or "")


def test_login_inactive_user_rejected(client, make_user, session):
    make_user(username="bob", password="bobbobbob", is_active=False)
    r = client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "bobbobbob"},
    )
    assert r.status_code == 401
    # No LOGIN success row; only the failure.
    success = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.LOGIN)
    ).all()
    assert success == []


def test_login_unknown_user_rejected(client):
    r = client.post(
        "/api/auth/login",
        json={"username": "ghost", "password": "whatever"},
    )
    assert r.status_code == 401


def test_expired_token_rejected(client, admin_user):
    """A JWT with exp in the past must be refused by protected endpoints."""
    expired = create_access_token(
        subject=admin_user.id,
        expires_delta=timedelta(seconds=-10),
    )
    r = client.get("/admin/api/users", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert "expired" in r.json()["detail"].lower() or "invalid" in r.json()["detail"].lower()


def test_malformed_token_rejected(client):
    r = client.get(
        "/admin/api/users",
        headers={"Authorization": "Bearer not.a.jwt"},
    )
    assert r.status_code == 401


def test_change_password_requires_current(client, admin_user, auth_headers):
    r = client.post(
        "/api/auth/change-password",
        headers=auth_headers,
        json={"current_password": "WRONG", "new_password": "newpassword123"},
    )
    assert r.status_code == 400


def test_change_password_rejects_short_pw(client, auth_headers):
    r = client.post(
        "/api/auth/change-password",
        headers=auth_headers,
        json={"current_password": "admin-pass-1234", "new_password": "short"},
    )
    # 422 from pydantic (min_length=8 on the schema).
    assert r.status_code == 422
