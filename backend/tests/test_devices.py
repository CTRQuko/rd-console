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


# ─── v3: note + is_favorite on PATCH ────────────────────────────────────────

def test_patch_sets_note_and_favorite(client, auth_headers, session):
    d = _seed_device(session)
    r = client.patch(
        f"/admin/api/devices/{d.id}",
        json={"note": "Juan's laptop — weekly patch", "is_favorite": True},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["note"] == "Juan's laptop — weekly patch"
    assert body["is_favorite"] is True


def test_list_devices_filters_by_favorite(client, auth_headers, session):
    _seed_device(session, rustdesk_id="111")
    d2 = _seed_device(session, rustdesk_id="222")
    client.patch(
        f"/admin/api/devices/{d2.id}",
        json={"is_favorite": True},
        headers=auth_headers,
    )
    r = client.get("/admin/api/devices?favorite=true", headers=auth_headers)
    assert r.status_code == 200
    ids = [row["rustdesk_id"] for row in r.json()]
    assert ids == ["222"]


# ─── v3: tag assignment ─────────────────────────────────────────────────────

def test_assign_and_unassign_tag(client, auth_headers, session):
    d = _seed_device(session)
    tag_resp = client.post(
        "/admin/api/tags", json={"name": "lab"}, headers=auth_headers
    )
    tag_id = tag_resp.json()["id"]

    r = client.post(
        f"/admin/api/devices/{d.id}/tags/{tag_id}", headers=auth_headers
    )
    assert r.status_code == 200
    names = [t["name"] for t in r.json()["tags"]]
    assert names == ["lab"]

    # Re-assigning is a no-op — still 200, still one tag.
    r = client.post(
        f"/admin/api/devices/{d.id}/tags/{tag_id}", headers=auth_headers
    )
    assert r.status_code == 200
    assert len(r.json()["tags"]) == 1

    r = client.delete(
        f"/admin/api/devices/{d.id}/tags/{tag_id}", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json()["tags"] == []

    actions = [
        row.action
        for row in session.exec(
            select(AuditLog).where(
                AuditLog.action.in_(
                    [AuditAction.DEVICE_TAGGED, AuditAction.DEVICE_UNTAGGED]
                )
            )
        ).all()
    ]
    assert AuditAction.DEVICE_TAGGED in actions
    assert AuditAction.DEVICE_UNTAGGED in actions


def test_list_devices_filters_by_tag(client, auth_headers, session):
    d1 = _seed_device(session, rustdesk_id="111")
    _seed_device(session, rustdesk_id="222")
    tag_id = client.post(
        "/admin/api/tags", json={"name": "lab"}, headers=auth_headers
    ).json()["id"]
    client.post(f"/admin/api/devices/{d1.id}/tags/{tag_id}", headers=auth_headers)

    r = client.get(
        f"/admin/api/devices?tag_id={tag_id}", headers=auth_headers
    )
    assert r.status_code == 200
    ids = [row["rustdesk_id"] for row in r.json()]
    assert ids == ["111"]


def test_forget_device_cleans_up_tag_links(client, auth_headers, session):
    d = _seed_device(session)
    device_id = d.id
    tag_id = client.post(
        "/admin/api/tags", json={"name": "t"}, headers=auth_headers
    ).json()["id"]
    client.post(f"/admin/api/devices/{device_id}/tags/{tag_id}", headers=auth_headers)
    # Detach only the rows the router will delete so we keep the rest of the
    # session (e.g. admin_user) bound.
    from app.models.tag import DeviceTag
    for link in session.exec(
        select(DeviceTag).where(DeviceTag.device_id == device_id)
    ).all():
        session.expunge(link)
    session.expunge(d)

    r = client.delete(f"/admin/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 204

    assert (
        session.exec(select(DeviceTag).where(DeviceTag.device_id == device_id)).all()
        == []
    )


# ─── v3: bulk operations ────────────────────────────────────────────────────

def test_bulk_favorite_sets_flag_and_writes_one_audit(client, auth_headers, session):
    d1 = _seed_device(session, rustdesk_id="111")
    d2 = _seed_device(session, rustdesk_id="222")
    d3 = _seed_device(session, rustdesk_id="333")

    r = client.post(
        "/admin/api/devices/bulk",
        json={"device_ids": [d1.id, d2.id, d3.id], "action": "favorite"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 3
    assert body["skipped"] == 0
    assert body["action"] == "favorite"

    # Exactly one bulk audit row despite 3 affected devices.
    rows = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_BULK_UPDATED)
    ).all()
    assert len(rows) == 1


def test_bulk_forget_removes_rows_and_skips_missing(client, auth_headers, session):
    d1 = _seed_device(session, rustdesk_id="111")
    d2 = _seed_device(session, rustdesk_id="222")
    id1, id2 = d1.id, d2.id
    # Detach only the device rows that the router will delete so session.get
    # below doesn't try to refresh a stale instance.
    session.expunge(d1)
    session.expunge(d2)

    r = client.post(
        "/admin/api/devices/bulk",
        json={"device_ids": [id1, id2, 9999], "action": "forget"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 2
    assert body["skipped"] == 1

    assert session.get(Device, id1) is None
    assert session.get(Device, id2) is None


def test_bulk_assign_tag_is_idempotent(client, auth_headers, session):
    d1 = _seed_device(session, rustdesk_id="111")
    d2 = _seed_device(session, rustdesk_id="222")
    tag_id = client.post(
        "/admin/api/tags", json={"name": "lab"}, headers=auth_headers
    ).json()["id"]
    # Already assign d1 manually so the bulk op has a no-op for that device.
    client.post(f"/admin/api/devices/{d1.id}/tags/{tag_id}", headers=auth_headers)

    r = client.post(
        "/admin/api/devices/bulk",
        json={
            "device_ids": [d1.id, d2.id],
            "action": "assign_tag",
            "tag_id": tag_id,
        },
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    # Only d2 was newly tagged; d1 was already tagged.
    assert body["affected"] == 1


def test_bulk_assign_tag_requires_tag_id(client, auth_headers, session):
    d = _seed_device(session)
    r = client.post(
        "/admin/api/devices/bulk",
        json={"device_ids": [d.id], "action": "assign_tag"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "tag_id" in r.json()["detail"]


def test_bulk_requires_auth(client):
    r = client.post(
        "/admin/api/devices/bulk",
        json={"device_ids": [1], "action": "favorite"},
    )
    assert r.status_code == 401
