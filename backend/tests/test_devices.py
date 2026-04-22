"""Devices: heartbeat ingest + online/offline filtering done in SQL."""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import select

from app.models.device import Device
from app.security import utcnow_naive


def test_heartbeat_creates_then_updates_device(client, session, auth_headers):
    r1 = client.post("/api/heartbeat", json={"id": "ABC-123"})
    assert r1.status_code == 200

    d = session.exec(select(Device).where(Device.rustdesk_id == "ABC-123")).one()
    first_seen = d.last_seen_at
    assert first_seen is not None

    # Second heartbeat must update, not duplicate.
    r2 = client.post("/api/heartbeat", json={"id": "ABC-123"})
    assert r2.status_code == 200

    session.expire_all()
    rows = session.exec(select(Device).where(Device.rustdesk_id == "ABC-123")).all()
    assert len(rows) == 1
    assert rows[0].last_seen_at >= first_seen

    # Shows up as online in admin listing.
    r = client.get("/admin/api/devices?status=online", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert any(x["rustdesk_id"] == "ABC-123" and x["online"] for x in body)


def test_status_filter_splits_online_and_offline(client, session, auth_headers):
    now = utcnow_naive()
    session.add(Device(rustdesk_id="FRESH", last_seen_at=now - timedelta(minutes=1)))
    session.add(Device(rustdesk_id="STALE", last_seen_at=now - timedelta(minutes=30)))
    session.add(Device(rustdesk_id="NEVER"))  # last_seen_at = None
    session.commit()

    online = client.get("/admin/api/devices?status=online", headers=auth_headers).json()
    offline = client.get("/admin/api/devices?status=offline", headers=auth_headers).json()

    online_ids = {d["rustdesk_id"] for d in online}
    offline_ids = {d["rustdesk_id"] for d in offline}
    assert online_ids == {"FRESH"}
    assert offline_ids == {"STALE", "NEVER"}


def test_device_404(client, auth_headers):
    r = client.get("/admin/api/devices/9999", headers=auth_headers)
    assert r.status_code == 404
