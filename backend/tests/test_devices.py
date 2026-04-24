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
    # v9: ONLINE_WINDOW is 15 min (was 5). Pick offsets that straddle the
    # new cutoff on either side so a future widening doesn't silently make
    # the assertions vacuous.
    _seed_device(session, rustdesk_id="111 111 111", last_seen_offset_min=1)
    _seed_device(session, rustdesk_id="222 222 222", last_seen_offset_min=20)
    _seed_device(session, rustdesk_id="333 333 333", last_seen_offset_min=None)

    r = client.get("/admin/api/devices", headers=auth_headers)
    assert r.status_code == 200
    by_id = {d["rustdesk_id"]: d for d in r.json()}
    assert by_id["111 111 111"]["online"] is True
    assert by_id["222 222 222"]["online"] is False
    assert by_id["333 333 333"]["online"] is False


def test_list_devices_online_boundary_10min_is_online(client, auth_headers, session):
    """Regression: when ONLINE_WINDOW was bumped from 5→15 min in v9 we
    want an explicit case showing that 10 min is still Online. If a future
    refactor drops the window back to <10 min this test fails loud."""
    _seed_device(session, rustdesk_id="window-check", last_seen_offset_min=10)

    r = client.get("/admin/api/devices", headers=auth_headers)
    assert r.status_code == 200
    by_id = {d["rustdesk_id"]: d for d in r.json()}
    assert by_id["window-check"]["online"] is True


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


# ─── v8: ?force=true calls delete_hbbs_peer (best-effort cleanup) ─────────────
#
# Upstream hbbr offers no admin interface for kicking active sessions — so
# "disconnect" remains audit-only by default. The ?force=true flag adds the
# strongest side effect we can actually achieve: drop the peer row from
# hbbs's own SQLite. The live tunnel keeps running, but the peer has to
# re-authenticate on its next reconnect, which is the closest thing to a
# real kick the panel can offer.


def test_disconnect_without_force_does_not_touch_hbbs(
    client, auth_headers, session, admin_user, monkeypatch
):
    d = _seed_device(session)
    calls: list[str] = []
    from app.routers import devices as _devices_router

    monkeypatch.setattr(
        _devices_router,
        "delete_hbbs_peer",
        lambda rd_id: calls.append(rd_id) or True,
    )

    r = client.post(
        f"/admin/api/devices/{d.id}/disconnect",
        headers=auth_headers,
    )
    assert r.status_code == 202
    assert calls == [], "no force flag → hbbs untouched"


def test_disconnect_with_force_calls_delete_hbbs_peer(
    client, auth_headers, session, admin_user, monkeypatch
):
    d = _seed_device(session, rustdesk_id="kick-me")
    calls: list[str] = []
    from app.routers import devices as _devices_router

    monkeypatch.setattr(
        _devices_router,
        "delete_hbbs_peer",
        lambda rd_id: calls.append(rd_id) or True,
    )

    r = client.post(
        f"/admin/api/devices/{d.id}/disconnect?force=true",
        headers=auth_headers,
    )
    assert r.status_code == 202
    assert calls == ["kick-me"]


def test_disconnect_force_audit_payload_records_flag(
    client, auth_headers, session, admin_user, monkeypatch
):
    d = _seed_device(session, rustdesk_id="kick-audit")
    from app.routers import devices as _devices_router

    monkeypatch.setattr(_devices_router, "delete_hbbs_peer", lambda _: True)

    r = client.post(
        f"/admin/api/devices/{d.id}/disconnect?force=true",
        headers=auth_headers,
    )
    assert r.status_code == 202

    import json as _json
    audit = session.exec(
        select(AuditLog).where(
            AuditLog.action == AuditAction.DEVICE_DISCONNECT_REQUESTED
        )
    ).first()
    payload = _json.loads(audit.payload)
    assert payload["force"] is True
    assert payload["hbbs_removed"] is True


def test_disconnect_response_frames_limit_as_upstream(
    client, auth_headers, session, admin_user
):
    """The old copy said 'hbbr does not yet expose...' which implied a
    future rd-console milestone. Upstream RustDesk doesn't expose the
    primitive at all — framing it as "coming soon" is misleading. New
    copy must acknowledge the limit is upstream (so an operator reading
    the response understands they can't wait for us to fix it)."""
    d = _seed_device(session)
    r = client.post(
        f"/admin/api/devices/{d.id}/disconnect",
        headers=auth_headers,
    )
    assert r.status_code == 202
    body = r.json()
    note = body.get("note", "")
    # Must not promise a future feature we don't control.
    assert "yet" not in note.lower()
    assert "future" not in note.lower()
    # Must explicitly tell the operator where the limit lives.
    assert "upstream" in note.lower()
    # Must surface the force hint so admins know the one best-effort
    # action they DO have.
    assert "force" in note.lower()


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


def test_forget_device_also_removes_hbbs_row(client, auth_headers, session, tmp_path, monkeypatch):
    """Coordinated forget: deleting a device via the panel must also wipe
    the corresponding row from hbbs's SQLite so the sync loop can't
    resurrect it on the next tick."""
    import sqlite3 as _sqlite3

    from app.config import get_settings

    # Build a throw-away hbbs DB with one matching peer row.
    hbbs_path = tmp_path / "db_v2.sqlite3"
    conn = _sqlite3.connect(hbbs_path)
    conn.executescript(
        """
        CREATE TABLE peer (
            guid blob primary key not null,
            id varchar(100) not null,
            uuid blob not null,
            pk blob not null,
            created_at datetime not null default(current_timestamp),
            user blob,
            status tinyint,
            note varchar(300),
            info text not null
        ) without rowid;
        """
    )
    conn.execute(
        "INSERT INTO peer (guid, id, uuid, pk, status, info) VALUES (?, ?, ?, ?, ?, ?)",
        (b"\x01", "forget-me", b"\x02", b"\x03", 0, '{"ip":"::ffff:10.0.0.1"}'),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(get_settings(), "hbbs_db_path", hbbs_path)

    d = _seed_device(session, rustdesk_id="forget-me")
    device_id = d.id

    r = client.delete(f"/admin/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 204

    # Panel row gone.
    session.expire_all()
    assert session.get(Device, device_id) is None

    # hbbs row gone too.
    rows = _sqlite3.connect(hbbs_path).execute(
        "SELECT id FROM peer WHERE id = ?", ("forget-me",)
    ).fetchall()
    assert rows == []

    # Audit trail records the coordinated cleanup.
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_FORGOTTEN)
    ).first()
    import json as _json
    payload = _json.loads(audit.payload)
    assert payload["hbbs_removed"] is True
    assert payload["cleanup"] == "both"


def test_forget_device_tolerates_missing_hbbs_file(
    client, auth_headers, session, tmp_path, monkeypatch
):
    """If the hbbs DB file is missing (e.g. sync mount not wired up),
    forget should still succeed on the panel side and flag the audit."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "hbbs_db_path", tmp_path / "missing.sqlite3")

    d = _seed_device(session, rustdesk_id="panel-only")
    device_id = d.id

    r = client.delete(f"/admin/api/devices/{device_id}", headers=auth_headers)
    assert r.status_code == 204

    session.expire_all()
    assert session.get(Device, device_id) is None

    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.DEVICE_FORGOTTEN)
    ).first()
    import json as _json
    payload = _json.loads(audit.payload)
    assert payload["hbbs_removed"] is False
    assert payload["cleanup"] == "panel-only"


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
