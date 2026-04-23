"""Admin join-token management — /admin/api/join-tokens."""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import select

from app.models.audit_log import AuditAction, AuditLog
from app.models.join_token import JoinToken
from app.security import utcnow_naive


def test_create_join_token_minimal(client, auth_headers, session):
    r = client.post("/admin/api/join-tokens", headers=auth_headers, json={})
    assert r.status_code == 201, r.text
    body = r.json()
    # Token plaintext is returned because the admin needs to paste it into
    # the invite URL — unlike PATs it's single-use and short-lived.
    assert body["token"]
    assert len(body["token"]) >= 32
    # Prefix matches leading chars of plaintext — admins can identify this
    # token in the list view without seeing the full secret.
    assert body["token_prefix"] == body["token"][:8]
    assert body["label"] is None
    assert body["used_at"] is None
    assert body["revoked"] is False
    assert body["status"] == "active"
    # DB round-trip: row exists and matches
    row = session.exec(
        select(JoinToken).where(JoinToken.id == body["id"])
    ).first()
    assert row is not None
    assert row.token == body["token"]
    # Audit entry stamped
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.JOIN_TOKEN_CREATED)
    ).first()
    assert audit is not None
    assert audit.actor_user_id is not None


def test_create_join_token_with_label_and_expiry(client, auth_headers):
    r = client.post(
        "/admin/api/join-tokens",
        headers=auth_headers,
        json={"label": "Abuela — laptop", "expires_in_minutes": 60},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["label"] == "Abuela — laptop"
    assert body["expires_at"] is not None
    assert body["status"] == "active"


def test_create_rejects_oversize_expiry(client, auth_headers):
    """30-day cap — invites are not long-lived credentials."""
    r = client.post(
        "/admin/api/join-tokens",
        headers=auth_headers,
        json={"expires_in_minutes": 30 * 24 * 60 + 1},
    )
    assert r.status_code == 422


def test_created_token_unlocks_public_join(client, auth_headers):
    """The minted token must be redeemable on the public /api/join/:token.
    Regression guard: if someone changes the token generation, the invite
    URL silently breaks."""
    from app.config import get_settings
    s = get_settings()
    s.server_host = "rd.example.com"
    s.panel_url = "https://panel.example.com"
    s.hbbs_public_key = "PUBKEY"

    created = client.post(
        "/admin/api/join-tokens",
        headers=auth_headers,
        json={"label": "brand new device"},
    ).json()
    r = client.get(f"/api/join/{created['token']}")
    assert r.status_code == 200
    assert r.json()["label"] == "brand new device"


def test_list_join_tokens_returns_status(client, auth_headers, session):
    """List computes status server-side so the UI doesn't have to
    duplicate the expiry/used/revoked priority logic."""
    now = utcnow_naive()
    # One of each status
    session.add(JoinToken(label="active"))
    session.add(JoinToken(label="expired", expires_at=now - timedelta(minutes=1)))
    session.add(JoinToken(label="used", used_at=now))
    session.add(JoinToken(label="revoked", revoked=True))
    # Revoked-after-use → "revoked" wins (forensics: the revoke was intentional)
    session.add(JoinToken(label="used-then-revoked", used_at=now, revoked=True))
    session.commit()

    # Default hides revoked (per UX feedback: revoke = out of sight).
    # Include them explicitly to verify the full status priority chain.
    r = client.get(
        "/admin/api/join-tokens?include_revoked=true", headers=auth_headers,
    )
    assert r.status_code == 200
    rows = r.json()
    # Redaction: list view NEVER includes plaintext ``token`` — only the
    # 8-char prefix. Matches the PAT pattern in /api/auth/tokens.
    for row in rows:
        assert "token" not in row
        assert len(row["token_prefix"]) == 8
    by_label = {row["label"]: row["status"] for row in rows}
    assert by_label["active"] == "active"
    assert by_label["expired"] == "expired"
    assert by_label["used"] == "used"
    assert by_label["revoked"] == "revoked"
    assert by_label["used-then-revoked"] == "revoked"

    # And confirm that the default (no flag) hides revoked.
    r2 = client.get("/admin/api/join-tokens", headers=auth_headers)
    labels_default = {row["label"] for row in r2.json()}
    assert "active" in labels_default
    assert "expired" in labels_default
    assert "used" in labels_default
    assert "revoked" not in labels_default
    assert "used-then-revoked" not in labels_default


def test_revoke_join_token(client, auth_headers, session):
    created = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={}
    ).json()
    r = client.delete(
        f"/admin/api/join-tokens/{created['id']}", headers=auth_headers
    )
    assert r.status_code == 204

    # Public join now 404s (revoked_token branch in join.py)
    public = client.get(f"/api/join/{created['token']}")
    assert public.status_code == 404

    # Audit entry
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.JOIN_TOKEN_REVOKED)
    ).first()
    assert audit is not None


def test_revoke_idempotent(client, auth_headers, session):
    """Double-revoke is a 204 no-op — no second audit row, no 409."""
    created = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={}
    ).json()
    first = client.delete(
        f"/admin/api/join-tokens/{created['id']}", headers=auth_headers
    )
    second = client.delete(
        f"/admin/api/join-tokens/{created['id']}", headers=auth_headers
    )
    assert first.status_code == 204
    assert second.status_code == 204
    audit_count = len(
        session.exec(
            select(AuditLog).where(AuditLog.action == AuditAction.JOIN_TOKEN_REVOKED)
        ).all()
    )
    assert audit_count == 1


def test_revoke_unknown_404(client, auth_headers):
    r = client.delete("/admin/api/join-tokens/99999", headers=auth_headers)
    assert r.status_code == 404


def test_non_admin_forbidden(client, make_user):
    """Regression: join-tokens are an admin-only operator tool. A regular
    user with a valid JWT must get 403, not 200, across every verb."""
    make_user(username="regular", password="pw-pw-pw-pw")
    r = client.post(
        "/api/auth/login",
        json={"username": "regular", "password": "pw-pw-pw-pw"},
    )
    user_token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {user_token}"}

    assert client.post("/admin/api/join-tokens", headers=headers, json={}).status_code == 403
    assert client.get("/admin/api/join-tokens", headers=headers).status_code == 403
    assert client.delete("/admin/api/join-tokens/1", headers=headers).status_code == 403


def test_unauthenticated_forbidden(client):
    assert client.post("/admin/api/join-tokens", json={}).status_code == 401
    assert client.get("/admin/api/join-tokens").status_code == 401
    assert client.delete("/admin/api/join-tokens/1").status_code == 401


# ─── Hard delete ────────────────────────────────────────────────────────────


def test_hard_delete_removes_row(client, auth_headers, session):
    created = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "goodbye"},
    ).json()
    r = client.delete(
        f"/admin/api/join-tokens/{created['id']}?hard=true", headers=auth_headers,
    )
    assert r.status_code == 204
    session.expunge_all()
    assert session.get(JoinToken, created["id"]) is None
    # Audit stamps the deletion fact.
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.JOIN_TOKEN_DELETED)
    ).first()
    assert audit is not None
    assert "goodbye" in (audit.payload or "")


def test_hard_delete_404_on_missing(client, auth_headers):
    r = client.delete("/admin/api/join-tokens/99999?hard=true", headers=auth_headers)
    assert r.status_code == 404


# ─── Bulk ops ───────────────────────────────────────────────────────────────


def test_bulk_revoke_mixed_with_already_revoked(client, auth_headers, session):
    a = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "a"},
    ).json()
    b = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "b"},
    ).json()
    # Pre-revoke b.
    client.delete(f"/admin/api/join-tokens/{b['id']}", headers=auth_headers)

    r = client.post(
        "/admin/api/join-tokens/bulk",
        headers=auth_headers,
        json={"action": "revoke", "ids": [a["id"], b["id"], 99999]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 1
    reasons = {s["id"]: s["reason"] for s in body["skipped"]}
    assert reasons[b["id"]] == "already_revoked"
    assert reasons[99999] == "not_found"


def test_bulk_delete_removes_rows(client, auth_headers, session):
    a = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "x"},
    ).json()
    b = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "y"},
    ).json()

    r = client.post(
        "/admin/api/join-tokens/bulk",
        headers=auth_headers,
        json={"action": "delete", "ids": [a["id"], b["id"]]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 2
    session.expunge_all()
    assert session.get(JoinToken, a["id"]) is None
    assert session.get(JoinToken, b["id"]) is None
    # Two JOIN_TOKEN_DELETED audit rows.
    audits = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.JOIN_TOKEN_DELETED)
    ).all()
    assert len(audits) == 2


def test_bulk_rejects_empty_ids(client, auth_headers):
    r = client.post(
        "/admin/api/join-tokens/bulk",
        headers=auth_headers,
        json={"action": "revoke", "ids": []},
    )
    assert r.status_code == 422


def test_bulk_rejects_bad_action(client, auth_headers):
    r = client.post(
        "/admin/api/join-tokens/bulk",
        headers=auth_headers,
        json={"action": "nuke", "ids": [1]},
    )
    assert r.status_code == 422


def test_bulk_rejects_non_admin(client, make_user):
    make_user(username="plainjt", password="plain-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "plainjt", "password": "plain-pass-1234"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(
        "/admin/api/join-tokens/bulk",
        headers=headers,
        json={"action": "revoke", "ids": [1]},
    )
    assert r.status_code == 403
