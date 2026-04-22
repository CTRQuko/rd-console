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
