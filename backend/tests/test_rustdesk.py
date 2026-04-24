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


# ─── Sysinfo diff → DEVICE_UPDATED audit (Sprint 1 A.1) ───────────────────────
#
# Before this feature the panel silently overwrote hostname/platform/version
# on every sysinfo tick. Admins had no way to see "this peer's OS flipped
# from Windows 10 to 11" or "the client jumped 2 major versions".
#
# The contract:
#   - First sysinfo for an unknown peer: creates the Device row, emits NO
#     audit entry (the CONNECT log from heartbeat already covers "new peer").
#   - Subsequent sysinfo with identical fields: no audit (idempotent).
#   - Subsequent sysinfo where hostname / platform / version changed:
#     ONE audit row of action=DEVICE_UPDATED with payload
#     {"rustdesk_id": ..., "changed": [<fields>], "before": {...}, "after": {...}}.


def test_sysinfo_first_seen_emits_no_audit(client, session):
    r = client.post(
        "/api/sysinfo",
        json={
            "id": "peer-firstseen",
            "hostname": "brand-new",
            "os": "Linux",
            "version": "1.2.3",
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert rows == [], "first sysinfo must not produce a DEVICE_UPDATED row"


def test_sysinfo_no_change_emits_no_audit(client, session):
    payload = {
        "id": "peer-same",
        "hostname": "same-host",
        "os": "Linux",
        "version": "1.2.3",
    }
    client.post("/api/sysinfo", json=payload)
    client.post("/api/sysinfo", json=payload)

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert rows == [], "identical sysinfo must be idempotent"


def test_sysinfo_hostname_change_emits_device_updated(client, session):
    client.post(
        "/api/sysinfo",
        json={"id": "peer-renamed", "hostname": "old-name", "os": "Linux", "version": "1.2.3"},
    )
    r = client.post(
        "/api/sysinfo",
        json={"id": "peer-renamed", "hostname": "new-name", "os": "Linux", "version": "1.2.3"},
    )
    assert r.status_code == 200

    import json
    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert len(rows) == 1
    data = json.loads(rows[0].payload)
    assert data["rustdesk_id"] == "peer-renamed"
    assert data["changed"] == ["hostname"]
    assert data["before"]["hostname"] == "old-name"
    assert data["after"]["hostname"] == "new-name"
    assert rows[0].from_id == "peer-renamed"


def test_sysinfo_multiple_fields_changed_single_audit(client, session):
    client.post(
        "/api/sysinfo",
        json={"id": "peer-upg", "hostname": "host", "os": "Windows", "version": "1.2.3"},
    )
    client.post(
        "/api/sysinfo",
        json={"id": "peer-upg", "hostname": "host-renamed", "os": "Linux", "version": "1.2.9"},
    )

    import json
    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert len(rows) == 1, "expected ONE audit row covering all changes"
    data = json.loads(rows[0].payload)
    assert set(data["changed"]) == {"hostname", "platform", "version"}
    assert data["before"] == {
        "hostname": "host",
        "platform": "Windows",
        "version": "1.2.3",
    }
    assert data["after"] == {
        "hostname": "host-renamed",
        "platform": "Linux",
        "version": "1.2.9",
    }


# ─── /api/audit/conn — CONNECT vs DISCONNECT (Sprint 2 A.2) ───────────────────
#
# The Flutter RustDesk client sends an `action` field that tells the server
# whether the session is starting or ending. Contract comes from the upstream
# kingmo888-compatible implementation at lejianwen/rustdesk-api (AuditConnForm):
#
#   action = "new"   → session started  → AuditAction.CONNECT
#   action = "close" → session ended    → AuditAction.DISCONNECT
#   action = ""      → update existing  → also CONNECT (audit log is append-only,
#                                         we don't merge; this is the back-compat
#                                         path for older clients / forks)
#   action unknown   → CONNECT (never 400 — the client can't recover from a
#                      rejected audit event, we'd rather record SOMETHING)
#
# The Flutter client also packs the from-peer info as `"peer": [id, name]`
# rather than a flat `from_id`. We accept both so older homebuilt clients
# that still send `from_id` don't regress.


def test_audit_conn_action_new_logs_as_connect(client, session):
    r = client.post(
        "/api/audit/conn",
        json={
            "action": "new",
            "id": "peer-receiver",
            "peer": ["peer-initiator", "alice"],
            "ip": "10.0.0.5",
            "session_id": 1234567890.0,
            "conn_id": 42,
            "type": 0,
            "uuid": "cafe-1",
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.CONNECT)
    ).first()
    assert row is not None
    # from_id comes from the peer[] array now, not the flat from_id key.
    assert row.from_id == "peer-initiator"
    assert row.to_id == "peer-receiver"
    assert row.ip == "10.0.0.5"


def test_audit_conn_action_close_logs_as_disconnect(client, session):
    r = client.post(
        "/api/audit/conn",
        json={
            "action": "close",
            "id": "peer-receiver",
            "peer": ["peer-initiator", "alice"],
            "ip": "10.0.0.5",
            "session_id": 1234567890.0,
            "conn_id": 42,
            "type": 0,
            "uuid": "cafe-1",
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DISCONNECT)
    ).first()
    assert row is not None
    assert row.from_id == "peer-initiator"
    assert row.to_id == "peer-receiver"


def test_audit_conn_empty_action_defaults_to_connect(client, session):
    """Back-compat: older clients / custom forks don't send `action`. The
    upstream behaviour there is 'update existing by (peer_id, conn_id)',
    but our audit log is append-only — easiest honest thing is to log it
    as CONNECT so operators still see something."""
    r = client.post(
        "/api/audit/conn",
        json={"id": "peer-receiver", "peer": ["peer-initiator", ""], "conn_id": 1},
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    rows = session.exec(
        select(AuditLog).where(
            AuditLog.action.in_([AuditAction.CONNECT, AuditAction.DISCONNECT])
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].action == AuditAction.CONNECT


def test_audit_conn_unknown_action_defaults_to_connect(client, session):
    """Defensive: a rogue/forked client sending action='zombie' must not 400.
    We log it as CONNECT — something useful rather than nothing."""
    r = client.post(
        "/api/audit/conn",
        json={
            "action": "zombie",
            "id": "peer-x",
            "peer": ["peer-y", "name"],
        },
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.CONNECT)
    ).first()
    assert row is not None


def test_audit_conn_accepts_legacy_from_id_flat_key(client, session):
    """Regression guard: some older clients (and the pre-v8 tests in this
    suite) use a flat `from_id` instead of the `peer` array. Both shapes
    must keep working."""
    r = client.post(
        "/api/audit/conn",
        json={"action": "new", "from_id": "legacy-peer", "to_id": "recv"},
    )
    assert r.status_code == 200

    from sqlmodel import select

    from app.models.audit_log import AuditAction, AuditLog
    row = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.CONNECT)
    ).first()
    assert row is not None
    assert row.from_id == "legacy-peer"
    assert row.to_id == "recv"


def test_audit_conn_debug_raw_env_logs_payload(client, session, monkeypatch, caplog):
    """With RD_DEBUG_RAW_AUDIT_CONN=1 the raw payload lands in the logs.
    Ops uses this during the next Flutter-client investigation spike to
    confirm any new fields the client started sending."""
    import logging

    from app import config

    config.get_settings.cache_clear()
    monkeypatch.setenv("RD_DEBUG_RAW_AUDIT_CONN", "1")

    with caplog.at_level(logging.INFO, logger="rd_console.audit"):
        r = client.post(
            "/api/audit/conn",
            json={"action": "new", "id": "peer-dbg", "peer": ["p2", "n"]},
        )
    assert r.status_code == 200
    # The raw-payload log line is tagged so ops can grep it. Assert on
    # a distinctive token rather than the whole body to stay robust
    # against dict ordering.
    assert any("audit_conn raw" in rec.message for rec in caplog.records), caplog.text
    # Reset so subsequent tests see fresh settings.
    config.get_settings.cache_clear()
