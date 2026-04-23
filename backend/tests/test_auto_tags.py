"""Auto-generated tags — services/auto_tags.py + tags router block on delete.

Covers the P5 redesign: tags populate passively from device platform /
version / owner, are flagged `auto=True` in the DB, and refuse deletion
through the admin tags endpoint.
"""

from __future__ import annotations

from sqlmodel import select

from app.models.device import Device
from app.models.tag import DeviceTag, Tag
from app.services.auto_tags import sync_auto_tags_for_device


def test_sync_creates_platform_tag(session, make_user):
    d = Device(rustdesk_id="DEV1", platform="Windows")
    session.add(d)
    session.commit()
    session.refresh(d)

    sync_auto_tags_for_device(session, d)
    session.commit()

    tags = session.exec(select(Tag).where(Tag.auto == True)).all()  # noqa: E712
    assert any(t.name == "Windows" and t.auto_source == "platform" for t in tags)
    # Linked to the device.
    link = session.exec(
        select(DeviceTag).where(DeviceTag.device_id == d.id)
    ).all()
    assert len(link) == 1


def test_sync_creates_version_bucket(session):
    d = Device(rustdesk_id="DEV2", platform="Linux", version="1.2.47-beta")
    session.add(d)
    session.commit()
    session.refresh(d)

    sync_auto_tags_for_device(session, d)
    session.commit()

    # Patch bump collapses to major.minor bucket, so v1.2.47 and v1.2.99
    # map to the same tag.
    tags = session.exec(select(Tag).where(Tag.auto_source == "version")).all()
    assert len(tags) == 1
    assert tags[0].name == "v1.2"


def test_sync_creates_owner_tag(session, make_user):
    owner = make_user(username="alice", password="alice-pass-1234")
    d = Device(rustdesk_id="DEV3", platform="macOS", owner_user_id=owner.id)
    session.add(d)
    session.commit()
    session.refresh(d)

    sync_auto_tags_for_device(session, d)
    session.commit()

    tags = session.exec(select(Tag).where(Tag.auto_source == "owner")).all()
    assert len(tags) == 1
    assert tags[0].name == "alice"


def test_sync_is_idempotent(session):
    d = Device(rustdesk_id="DEV4", platform="Windows", version="1.0.0")
    session.add(d)
    session.commit()
    session.refresh(d)

    for _ in range(3):
        sync_auto_tags_for_device(session, d)
        session.commit()

    tags = session.exec(select(Tag).where(Tag.auto == True)).all()  # noqa: E712
    # Windows + v1.0 — exactly 2, not 6.
    assert len(tags) == 2
    links = session.exec(select(DeviceTag).where(DeviceTag.device_id == d.id)).all()
    assert len(links) == 2


def test_sync_removes_stale_tag_when_attribute_changes(session, make_user):
    """Platform change: old auto-tag gets unlinked, new one linked."""
    d = Device(rustdesk_id="DEV5", platform="Windows")
    session.add(d)
    session.commit()
    session.refresh(d)

    sync_auto_tags_for_device(session, d)
    session.commit()

    # Change platform.
    d.platform = "Linux"
    session.add(d)
    sync_auto_tags_for_device(session, d)
    session.commit()

    # Device's current platform auto-tag links.
    link_rows = session.exec(
        select(DeviceTag, Tag).where(DeviceTag.device_id == d.id).where(
            DeviceTag.tag_id == Tag.id,
        )
    ).all()
    link_names = {t.name for (_, t) in link_rows}
    assert link_names == {"Linux"}


def test_sync_does_not_touch_manual_tags(session):
    """Admin-assigned tags (auto=False) must not be removed or edited
    by the sync — they're outside auto_tags' jurisdiction."""
    d = Device(rustdesk_id="DEV6", platform="Windows")
    manual = Tag(name="lab", color="blue", auto=False)
    session.add_all([d, manual])
    session.commit()
    session.refresh(d)
    session.refresh(manual)

    session.add(DeviceTag(device_id=d.id, tag_id=manual.id))
    session.commit()

    sync_auto_tags_for_device(session, d)
    session.commit()

    # Manual link survives, auto Windows tag added alongside.
    links = session.exec(select(DeviceTag).where(DeviceTag.device_id == d.id)).all()
    assert len(links) == 2


def test_router_rejects_delete_of_auto_tag(client, auth_headers, session):
    """DELETE /admin/api/tags/{id} on an auto-tag → 400 with helpful copy."""
    auto = Tag(name="Windows", color="zinc", auto=True, auto_source="platform")
    session.add(auto)
    session.commit()
    session.refresh(auto)

    r = client.delete(f"/admin/api/tags/{auto.id}", headers=auth_headers)
    assert r.status_code == 400
    assert "auto" in r.json()["detail"].lower()
    # Tag still there.
    assert session.get(Tag, auto.id) is not None


def test_router_exposes_auto_fields(client, auth_headers, session):
    """GET list includes `auto` and `auto_source` so the UI can render
    chips differently (tooltip, no delete button)."""
    session.add(Tag(name="Windows", color="zinc", auto=True, auto_source="platform"))
    session.add(Tag(name="lab", color="blue", auto=False))
    session.commit()

    r = client.get("/admin/api/tags", headers=auth_headers)
    assert r.status_code == 200
    rows = r.json()
    by_name = {row["name"]: row for row in rows}
    assert by_name["Windows"]["auto"] is True
    assert by_name["Windows"]["auto_source"] == "platform"
    assert by_name["lab"]["auto"] is False
    assert by_name["lab"]["auto_source"] is None
