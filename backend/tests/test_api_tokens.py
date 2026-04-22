"""Personal Access Tokens — CRUD, auth integration, scope isolation."""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import select

from app.models.api_token import ApiToken
from app.models.audit_log import AuditAction, AuditLog
from app.security import (
    API_TOKEN_PREFIX,
    generate_api_token,
    hash_api_token,
    utcnow_naive,
)

# ─── Unit helpers ───────────────────────────────────────────────────────────


def test_generate_token_shape():
    """Plaintext tokens start with the namespace prefix and have enough
    entropy that collisions are astronomically unlikely."""
    t = generate_api_token()
    assert t.startswith(API_TOKEN_PREFIX)
    # prefix (5) + urlsafe_b64(32 bytes) == 5 + 43 chars
    assert len(t) >= 45
    # Second call must be different.
    assert t != generate_api_token()


def test_hash_is_deterministic():
    t = generate_api_token()
    assert hash_api_token(t) == hash_api_token(t)
    assert hash_api_token(t) != hash_api_token(generate_api_token())


# ─── CRUD ──────────────────────────────────────────────────────────────────


def test_create_token_returns_plaintext_once(client, auth_headers):
    r = client.post(
        "/api/auth/tokens",
        json={"name": "cron"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"].startswith(API_TOKEN_PREFIX)
    meta = body["metadata"]
    assert meta["name"] == "cron"
    assert meta["token_prefix"] == body["token"][:12]
    assert meta["revoked_at"] is None
    assert meta["expires_at"] is None


def test_list_tokens_hides_plaintext(client, auth_headers):
    client.post("/api/auth/tokens", json={"name": "a"}, headers=auth_headers)
    client.post("/api/auth/tokens", json={"name": "b"}, headers=auth_headers)
    r = client.get("/api/auth/tokens", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    # No plaintext in list responses — only metadata.
    for item in items:
        assert "token" not in item
        assert item["token_prefix"].startswith(API_TOKEN_PREFIX)


def test_revoke_token_makes_it_unusable(client, auth_headers, session):
    created = client.post(
        "/api/auth/tokens",
        json={"name": "to-revoke"},
        headers=auth_headers,
    ).json()
    token_id = created["metadata"]["id"]
    plaintext = created["token"]

    # Token works before revocation.
    r_pre = client.get("/api/auth/me", headers={"Authorization": f"Bearer {plaintext}"})
    assert r_pre.status_code == 200

    r_del = client.delete(f"/api/auth/tokens/{token_id}", headers=auth_headers)
    assert r_del.status_code == 204

    # Token is dead after revocation.
    r_post = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {plaintext}"},
    )
    assert r_post.status_code == 401


def test_revoke_is_idempotent(client, auth_headers):
    created = client.post(
        "/api/auth/tokens", json={"name": "x"}, headers=auth_headers
    ).json()
    token_id = created["metadata"]["id"]
    assert client.delete(
        f"/api/auth/tokens/{token_id}", headers=auth_headers
    ).status_code == 204
    # Second delete still returns 204.
    assert client.delete(
        f"/api/auth/tokens/{token_id}", headers=auth_headers
    ).status_code == 204


def test_revoke_unknown_id_is_404(client, auth_headers):
    assert client.delete(
        "/api/auth/tokens/999999", headers=auth_headers
    ).status_code == 404


# ─── Auth integration ──────────────────────────────────────────────────────


def test_pat_can_auth_api_calls(client, auth_headers):
    created = client.post(
        "/api/auth/tokens", json={"name": "pat"}, headers=auth_headers
    ).json()
    pat = created["token"]

    # Use the PAT to hit the same endpoints the JWT can hit.
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {pat}"})
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_pat_bumps_last_used_at(client, auth_headers, session, engine):
    from sqlmodel import Session

    created = client.post(
        "/api/auth/tokens", json={"name": "pat"}, headers=auth_headers
    ).json()
    token_id = created["metadata"]["id"]
    pat = created["token"]

    # Fresh token has no last_used_at.
    with Session(engine) as s:
        row = s.get(ApiToken, token_id)
        assert row is not None
        assert row.last_used_at is None

    client.get("/api/auth/me", headers={"Authorization": f"Bearer {pat}"})

    with Session(engine) as s:
        row = s.get(ApiToken, token_id)
        assert row is not None
        assert row.last_used_at is not None


def test_expired_pat_is_rejected(client, auth_headers, engine):
    from sqlmodel import Session

    created = client.post(
        "/api/auth/tokens",
        json={"name": "pat", "expires_in_minutes": 60},
        headers=auth_headers,
    ).json()
    pat = created["token"]
    token_id = created["metadata"]["id"]

    # Force-expire the row.
    with Session(engine) as s:
        row = s.get(ApiToken, token_id)
        assert row is not None
        row.expires_at = utcnow_naive() - timedelta(minutes=1)
        s.add(row)
        s.commit()

    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {pat}"})
    assert r.status_code == 401


def test_unknown_pat_shape_is_401(client):
    # Right prefix, wrong payload: must be 401, NOT 500.
    r = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {API_TOKEN_PREFIX}not-a-real-token"},
    )
    assert r.status_code == 401


def test_malformed_auth_header_does_not_crash(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


def test_pat_for_inactive_user_is_rejected(client, auth_headers, admin_user, session):
    created = client.post(
        "/api/auth/tokens", json={"name": "pat"}, headers=auth_headers
    ).json()
    pat = created["token"]

    # Disable the owner.
    admin_user.is_active = False
    session.add(admin_user)
    session.commit()

    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {pat}"})
    assert r.status_code == 401


# ─── Scope isolation ───────────────────────────────────────────────────────


def test_user_cannot_see_other_users_tokens(client, admin_user, make_user, auth_headers):
    # Admin creates a token.
    admin_created = client.post(
        "/api/auth/tokens", json={"name": "admin-tok"}, headers=auth_headers
    ).json()
    admin_token_id = admin_created["metadata"]["id"]

    # Second user logs in and lists — must NOT see admin's token.
    make_user(username="bob", password="bob-pass-1234")
    bob_jwt = client.post(
        "/api/auth/login", json={"username": "bob", "password": "bob-pass-1234"}
    ).json()["access_token"]
    bob_headers = {"Authorization": f"Bearer {bob_jwt}"}

    r = client.get("/api/auth/tokens", headers=bob_headers)
    assert r.status_code == 200
    assert r.json() == []

    # Bob cannot revoke admin's token.
    r_del = client.delete(
        f"/api/auth/tokens/{admin_token_id}", headers=bob_headers
    )
    assert r_del.status_code == 404  # same-shape 404 — no enumeration leak


# ─── Audit logging ─────────────────────────────────────────────────────────


def test_create_and_revoke_emit_audit_rows(client, auth_headers, admin_user, engine):
    """Both long-lived-credential lifecycle events land in audit_logs so the
    auth tab in the admin log view can surface them."""
    from sqlmodel import Session

    created = client.post(
        "/api/auth/tokens", json={"name": "audited"}, headers=auth_headers
    ).json()
    token_id = created["metadata"]["id"]

    with Session(engine) as s:
        rows = s.exec(
            select(AuditLog).where(AuditLog.action == AuditAction.API_TOKEN_CREATED)
        ).all()
        assert len(rows) == 1
        assert rows[0].actor_user_id == admin_user.id
        assert f"id={token_id}" in (rows[0].payload or "")
        assert f"prefix={created['metadata']['token_prefix']}" in (rows[0].payload or "")

    r_del = client.delete(f"/api/auth/tokens/{token_id}", headers=auth_headers)
    assert r_del.status_code == 204

    with Session(engine) as s:
        rows = s.exec(
            select(AuditLog).where(AuditLog.action == AuditAction.API_TOKEN_REVOKED)
        ).all()
        assert len(rows) == 1
        assert rows[0].actor_user_id == admin_user.id
        assert f"id={token_id}" in (rows[0].payload or "")


# ─── Admin vs user-role PATs against /admin/... ─────────────────────────────


def test_admin_pat_reaches_admin_endpoint(client, auth_headers):
    """An admin's PAT inherits the same role as the user — it MUST be able
    to hit /admin/... endpoints, otherwise PATs are useless for automation."""
    created = client.post(
        "/api/auth/tokens", json={"name": "admin-pat"}, headers=auth_headers
    ).json()
    pat = created["token"]
    r = client.get(
        "/admin/api/devices", headers={"Authorization": f"Bearer {pat}"}
    )
    assert r.status_code == 200, r.text


def test_user_role_pat_blocked_on_admin_endpoint(client, make_user):
    """A non-admin's PAT MUST be rejected by require_admin exactly like a
    non-admin JWT would be — the PAT path cannot escalate privilege."""
    make_user(username="bob", password="bob-pass-1234")
    bob_jwt = client.post(
        "/api/auth/login", json={"username": "bob", "password": "bob-pass-1234"}
    ).json()["access_token"]
    bob_headers = {"Authorization": f"Bearer {bob_jwt}"}

    created = client.post(
        "/api/auth/tokens", json={"name": "bob-pat"}, headers=bob_headers
    ).json()
    pat = created["token"]

    r = client.get(
        "/admin/api/devices", headers={"Authorization": f"Bearer {pat}"}
    )
    assert r.status_code == 403
