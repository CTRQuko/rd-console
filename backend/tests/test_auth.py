"""Auth flow tests — login happy/edge paths, token validation."""

from __future__ import annotations

from datetime import timedelta

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


# ─── /api/auth/sessions — active JWT sessions list/revoke ───────────────────


def test_sessions_lists_only_caller_jwt(client, make_user):
    """The caller's login row should appear; another user's shouldn't."""
    # Create two users + log them both in.
    make_user(username="carla", password="correct-horse-battery")
    make_user(username="dario", password="correct-horse-battery")

    r1 = client.post("/api/auth/login", json={"username": "carla", "password": "correct-horse-battery"})
    r2 = client.post("/api/auth/login", json={"username": "dario", "password": "correct-horse-battery"})
    t1 = r1.json()["access_token"]
    _t2 = r2.json()["access_token"]

    sessions = client.get("/api/auth/sessions", headers={"Authorization": f"Bearer {t1}"}).json()
    assert len(sessions) == 1
    assert sessions[0]["is_current"] is True


def test_revoke_session_blocks_subsequent_calls(client, make_user):
    make_user(username="elena", password="correct-horse-battery")
    r1 = client.post("/api/auth/login", json={"username": "elena", "password": "correct-horse-battery"})
    t1 = r1.json()["access_token"]
    r2 = client.post("/api/auth/login", json={"username": "elena", "password": "correct-horse-battery"})
    t2 = r2.json()["access_token"]

    # Use t1 to revoke the session associated with t2.
    sessions = client.get("/api/auth/sessions", headers={"Authorization": f"Bearer {t1}"}).json()
    other = next(s for s in sessions if not s["is_current"])
    r = client.delete(
        f"/api/auth/sessions/{other['jti']}",
        headers={"Authorization": f"Bearer {t1}"},
    )
    assert r.status_code == 204

    # t2 should now be rejected.
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {t2}"})
    assert r.status_code == 401


def test_revoke_unknown_session_404(client, admin_token):
    r = client.delete(
        "/api/auth/sessions/not-a-real-jti",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 404


def test_cannot_revoke_other_users_session(client, make_user):
    """A user who knows another user's jti still gets a 404 — keeps the
    presence of the jti unrevealed."""
    make_user(username="franco", password="correct-horse-battery")
    make_user(username="gloria", password="correct-horse-battery")
    f_login = client.post("/api/auth/login", json={"username": "franco", "password": "correct-horse-battery"}).json()
    g_login = client.post("/api/auth/login", json={"username": "gloria", "password": "correct-horse-battery"}).json()
    f_sessions = client.get(
        "/api/auth/sessions",
        headers={"Authorization": f"Bearer {f_login['access_token']}"},
    ).json()
    f_jti = f_sessions[0]["jti"]
    # Gloria tries to revoke Franco's jti.
    r = client.delete(
        f"/api/auth/sessions/{f_jti}",
        headers={"Authorization": f"Bearer {g_login['access_token']}"},
    )
    assert r.status_code == 404
