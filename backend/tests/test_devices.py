"""Tests for /admin/api/devices (v2)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device


def _seed_device(
    session: Session,
    *,
    rustdesk_id: str = "123 456 789",
    hostname: str = "DESKTOP-A",
    platform: str | None = "Windows",
    owner_user_id: int | None = None,
    last_seen_offset_min: float | None = 1,
) -> Device:
    d = Device(
        rustdesk_id=rustdesk_id,
        hostname=hostname,
        username="alice",
        platform=platform,
        cpu="12C Intel",
        version="1.4.0",
        owner_user_id=owner_user_id,
        last_ip="10.0.0.1",
        last_seen_at=(
            datetime.utcnow() - timedelta(minutes=last_seen_offset_min)
            if last_seen_offset_min is not None
            else None
        ),
    )
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


def test_list_devices_computes_online_flag(client, auth_headers, session):
    _seed_device(session, rustdesk_id="111 111 111", last_seen_offset_min=1)
    _seed_device(session, rustdesk_id="222 222 222", last_seen_offset_min=10)
    _seed_device(session, rustdesk_id="333 333 333", last_seen_offset_min=None)

    r = client.get("/admin/api/devices", headers=auth_headers)
    assert r.status_code == 200
    by_id = {d["rustdesk_id"]: d for d in r.json()}
    assert by_id["111 111 111"]["online"] is True
    assert by_id["222 222 222"]["online"] is False
    assert by_id["333 333 333"]["online"] is False


def test_list_devices_filter_online_and_platform(client, auth_headers, session):
    _seed_device(session, rustdesk_id="1", platform="Windows", last_seen_offset_min=1)
    _seed_device(session, rustdesk_id="2", platform="macOS", last_seen_offset_min=99)
    _seed_device(session, rustdesk_id="3", platform="Windows", last_seen_offset_min=99)

    r = client.get("/admin/api/devices?status=online", headers=auth_headers)
    assert r.status_code == 200
    got = [d["rustdesk_id"] for d in r.json()]
    assert got == ["1"]

    r = client.get("/admin/api/devices?platform=Windows", headers=auth_headers)
    got = {d["rustdesk_id"] for d in r.json()}
    assert got == {"1", "3"}


def test_patch_device_updates_and_audits(client, auth_headers, session, admin_user, make_user):
    owner = make_user(username="newowner")
    d = _seed_device(session)

    r = client.patch(
        f"/admin/api/devices/{d.id}",
        headers=auth_headers,
        json={"hostname": "DESKTOP-RENAMED", "owner_user_id": owner.id},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hostname"] == "DESKTOP-RENAMED"
    assert body["owner_user_id"] == owner.id

    # Audit row was written with action=device_updated + actor_user_id=admin.
    entries = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert len(entries) == 1
    assert entries[0].actor_user_id == admin_user.id
    assert '"hostname"' in (entries[0].payload or "")


def test_patch_device_rejects_unknown_owner(client, auth_headers, session):
    d = _seed_device(session)
    r = client.patch(
        f"/admin/api/devices/{d.id}",
        headers=auth_headers,
        json={"owner_user_id": 999999},
    )
    assert r.status_code == 422, r.text


def test_patch_device_noop_does_not_audit(client, auth_headers, session):
    d = _seed_device(session, hostname="DESKTOP-A")
    r = client.patch(
        f"/admin/api/devices/{d.id}",
        headers=auth_headers,
        json={"hostname": "DESKTOP-A"},
    )
    assert r.status_code == 200
    entries = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_UPDATED)
    ).all()
    assert entries == []


def test_delete_device_removes_row_and_audits(client, auth_headers, session, admin_user):
    d = _seed_device(session, rustdesk_id="999 999 999")
    device_id = d.id
    rd_id = d.rustdesk_id

    r = client.delete(f"/admin/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 204

    # The router deletes via its own session; expire the test session's
    # identity map so it sees the committed state rather than a cached row.
    session.expire_all()
    assert session.get(Device, device_id) is None
    entries = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_FORGOTTEN)
    ).all()
    assert len(entries) == 1
    assert entries[0].from_id == rd_id
    assert entries[0].actor_user_id == admin_user.id


def test_disconnect_device_is_logged_and_idempotent(client, auth_headers, session, admin_user):
    d = _seed_device(session)

    for _ in range(2):
        r = client.post(
            f"/admin/api/devices/{d.id}/disconnect", headers=auth_headers
        )
        assert r.status_code == 202, r.text
        assert r.json()["ok"] is True

    entries = session.exec(
        select(AuditLog).where(
            AuditLog.action == AuditAction.DEVICE_DISCONNECT_REQUESTED
        )
    ).all()
    assert len(entries) == 2


def test_disconnect_missing_device_still_logs(client, auth_headers, session, admin_user):
    r = client.post("/admin/api/devices/424242/disconnect", headers=auth_headers)
    assert r.status_code == 202
    entries = session.exec(
        select(AuditLog).where(
            AuditLog.action == AuditAction.DEVICE_DISCONNECT_REQUESTED
        )
    ).all()
    assert len(entries) == 1
    assert entries[0].from_id is None


def test_devices_endpoints_require_auth(client, session):
    _seed_device(session)
    assert client.get("/admin/api/devices").status_code == 401
    assert client.delete("/admin/api/devices/1").status_code == 401
    assert client.post("/admin/api/devices/1/disconnect").status_code == 401
