"""RustDesk client-protocol endpoints: shared-secret gating + payload truncation."""

from __future__ import annotations

import pytest

from app.config import get_settings


@pytest.fixture()
def with_client_secret():
    s = get_settings()
    original = s.client_shared_secret
    s.client_shared_secret = "s3cret"
    try:
        yield "s3cret"
    finally:
        s.client_shared_secret = original


def test_heartbeat_blocked_without_secret(client, with_client_secret):
    r = client.post("/api/heartbeat", json={"id": "X"})
    assert r.status_code == 401


def test_heartbeat_allowed_with_correct_secret(client, with_client_secret):
    r = client.post(
        "/api/heartbeat",
        json={"id": "X"},
        headers={"X-RD-Secret": "s3cret"},
    )
    assert r.status_code == 200


def test_heartbeat_uses_xff_as_last_ip(client, session, with_client_secret):
    """The hbbs-watcher sidecar forwards the real peer IP via
    X-Forwarded-For (the raw socket is the sidecar itself). Verify we honor
    XFF and store the upstream IP on the device row."""
    r = client.post(
        "/api/heartbeat",
        json={"id": "xff-peer-01"},
        headers={
            "X-RD-Secret": "s3cret",
            "X-Forwarded-For": "192.168.1.34",
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.device import Device

    session.expire_all()
    dev = session.exec(
        select(Device).where(Device.rustdesk_id == "xff-peer-01")
    ).first()
    assert dev is not None
    assert dev.last_ip == "192.168.1.34"
    assert dev.last_seen_at is not None


def test_heartbeat_xff_takes_first_hop(client, session, with_client_secret):
    """XFF may be a comma-list when multiple proxies chain. We only trust
    the leftmost (the original client)."""
    r = client.post(
        "/api/heartbeat",
        json={"id": "xff-chain"},
        headers={
            "X-RD-Secret": "s3cret",
            "X-Forwarded-For": "10.0.0.5, 192.168.1.40, 172.17.0.1",
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.device import Device

    session.expire_all()
    dev = session.exec(
        select(Device).where(Device.rustdesk_id == "xff-chain")
    ).first()
    assert dev is not None
    assert dev.last_ip == "10.0.0.5"


def test_audit_payload_is_truncated(client, session):
    # No secret configured → open. Send a big blob and verify truncation.
    huge = "A" * 20_000
    r = client.post("/api/audit/conn", json={"from_id": "a", "to_id": "b", "blob": huge})
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(select(AuditLog).where(AuditLog.action == AuditAction.CONNECT)).first()
    assert row is not None
    assert row.payload is not None
    # Default cap is 4096; must be ≤ cap.
    assert len(row.payload) <= get_settings().max_audit_payload_bytes


# ─── Legacy RustDesk client auth (kingmo888 /api/login contract) ──────────────
#
# These endpoints exist so the native Flutter client can sign in and sync the
# address book the panel already stores. Shape mirrors kingmo888's response
# closely enough that off-the-shelf client builds work without per-version
# tweaks.


def test_legacy_login_returns_kingmo_shape(client, make_user):
    make_user(username="flutter", password="super-secret-pw", role=__import__(
        "app.models.user", fromlist=["UserRole"]).UserRole.USER)
    r = client.post(
        "/api/login",
        json={
            "username": "flutter",
            "password": "super-secret-pw",
            # Client adds these; we must ignore rather than 422.
            "id": "1779980041",
            "uuid": "deadbeef",
            "autoLogin": True,
            "deviceInfo": {"os": "Windows"},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["type"] == "access_token"
    assert body["access_token"]
    assert body["user"]["name"] == "flutter"
    assert body["user"]["is_admin"] is False
    assert body["user"]["status"] == 1
    # Forward-compat fields expected by some client builds
    assert "tfa_type" in body
    assert "secret" in body


def test_legacy_login_bad_password_401(client, make_user):
    make_user(username="flutter", password="correct-one")
    r = client.post(
        "/api/login",
        json={"username": "flutter", "password": "wrong"},
    )
    assert r.status_code == 401


def test_legacy_login_token_composes_with_address_book(client, make_user):
    """The JWT minted by /api/login must be accepted by /api/ab/get — that's
    the whole point of the alias. Regression guard: if someone changes the
    subject format, the Flutter client silently loses access to its own AB."""
    make_user(username="flutter", password="pw-pw-pw-pw")
    r = client.post(
        "/api/login",
        json={"username": "flutter", "password": "pw-pw-pw-pw"},
    )
    token = r.json()["access_token"]
    # AB is empty for a fresh user — we just need to verify the dep chain
    # accepts this token (a failed auth would 401, not 200).
    r2 = client.post(
        "/api/ab/get",
        json={"id": "anything"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200, r2.text


def test_legacy_current_user_echoes_identity(client, make_user):
    make_user(username="flutter", password="pw-pw-pw-pw")
    r = client.post(
        "/api/login",
        json={"username": "flutter", "password": "pw-pw-pw-pw"},
    )
    token = r.json()["access_token"]
    r2 = client.post(
        "/api/currentUser",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["name"] == "flutter"
    # kingmo888 echoes the token + type back so the Flutter client can
    # refresh its cached triple on every session probe. Regression guard.
    assert body["access_token"] == token
    assert body["type"] == "access_token"


def test_legacy_current_user_requires_token(client):
    r = client.post("/api/currentUser")
    assert r.status_code == 401


def test_legacy_logout_returns_200(client):
    """Stateless JWT — logout is a client-side concern. We just 200 so the
    client's sign-out flow completes cleanly."""
    r = client.post("/api/logout", json={"id": "1779980041", "uuid": "x"})
    assert r.status_code == 200
    # kingmo888's exact shape — the Flutter client branches on `code == 1`
    # to decide whether to clear its local session, so anything else hangs.
    assert r.json() == {"code": 1}


def test_legacy_login_not_gated_by_client_secret(client, make_user, with_client_secret):
    """Even with RD_CLIENT_SHARED_SECRET set, /api/login must remain open —
    the Flutter client never sends X-RD-Secret on the auth flow."""
    make_user(username="flutter", password="pw-pw-pw-pw")
    r = client.post(
        "/api/login",
        json={"username": "flutter", "password": "pw-pw-pw-pw"},
    )
    assert r.status_code == 200


def test_audit_payload_is_valid_json_string(client, session):
    r = client.post("/api/audit/file", json={"from_id": "a", "to_id": "b", "size": 10})
    assert r.status_code == 200
    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(select(AuditLog).where(AuditLog.action == AuditAction.FILE_TRANSFER)).first()
    assert row.payload and row.payload.startswith("{") and row.payload.endswith("}")
    # Round-trippable JSON (regression: old code used str(dict), not JSON)
    import json
    data = json.loads(row.payload)
    assert data["from_id"] == "a"
