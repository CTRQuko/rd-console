"""/admin/api/tags — CRUD + case-insensitive uniqueness + cascade cleanup."""

from __future__ import annotations

from sqlmodel import Session, select

from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device
from app.models.tag import DeviceTag, Tag


def _seed_device(session: Session, *, rustdesk_id: str = "111 222 333") -> Device:
    d = Device(rustdesk_id=rustdesk_id, hostname="desktop-a")
    session.add(d)
    session.commit()
    session.refresh(d)
    return d


def test_create_tag_happy_path(client, auth_headers, admin_user):
    r = client.post(
        "/admin/api/tags",
        json={"name": "Office", "color": "blue"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Office"
    assert body["color"] == "blue"
    assert body["device_count"] == 0
    assert body["id"] > 0


def test_create_tag_rejects_bad_color(client, auth_headers):
    r = client.post(
        "/admin/api/tags",
        json={"name": "x", "color": "magenta"},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "color" in r.json()["detail"]


def test_create_tag_rejects_case_insensitive_duplicate(client, auth_headers, session):
    client.post("/admin/api/tags", json={"name": "Office"}, headers=auth_headers)
    r = client.post(
        "/admin/api/tags",
        json={"name": "office"},
        headers=auth_headers,
    )
    assert r.status_code == 409
    # Only one row persisted.
    assert len(session.exec(select(Tag)).all()) == 1


def test_list_tags_returns_device_count(client, auth_headers, session):
    # Arrange: 1 tag attached to 2 devices, another tag attached to none.
    client.post("/admin/api/tags", json={"name": "lab"}, headers=auth_headers)
    client.post("/admin/api/tags", json={"name": "empty"}, headers=auth_headers)

    tags = session.exec(select(Tag).order_by(Tag.name)).all()
    lab = next(t for t in tags if t.name == "lab")
    d1 = _seed_device(session, rustdesk_id="111")
    d2 = _seed_device(session, rustdesk_id="222")
    session.add(DeviceTag(device_id=d1.id, tag_id=lab.id))
    session.add(DeviceTag(device_id=d2.id, tag_id=lab.id))
    session.commit()

    r = client.get("/admin/api/tags", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    # Sorted by name: "empty" then "lab"
    names = [t["name"] for t in body]
    assert names == ["empty", "lab"]
    counts = {t["name"]: t["device_count"] for t in body}
    assert counts == {"empty": 0, "lab": 2}


def test_delete_tag_cleans_up_device_links_and_audits(
    client, auth_headers, session, admin_user
):
    admin_user_id = admin_user.id  # capture before potentially expunging
    client.post("/admin/api/tags", json={"name": "lab"}, headers=auth_headers)
    tag = session.exec(select(Tag)).first()
    tag_id = tag.id
    d = _seed_device(session, rustdesk_id="333")
    device_id = d.id
    session.add(DeviceTag(device_id=device_id, tag_id=tag_id))
    session.commit()
    # Detach only the rows that the router will delete so the test session
    # can still use admin_user / device refreshes afterward.
    for link in session.exec(select(DeviceTag).where(DeviceTag.tag_id == tag_id)).all():
        session.expunge(link)
    session.expunge(tag)

    r = client.delete(f"/admin/api/tags/{tag_id}", headers=auth_headers)
    assert r.status_code == 204

    assert session.get(Tag, tag_id) is None
    assert session.exec(select(DeviceTag).where(DeviceTag.tag_id == tag_id)).all() == []

    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.TAG_DELETED)
    ).all()
    assert len(audit) == 1
    assert audit[0].actor_user_id == admin_user_id


def test_delete_tag_missing_returns_404(client, auth_headers):
    r = client.delete("/admin/api/tags/9999", headers=auth_headers)
    assert r.status_code == 404


def test_tag_endpoints_require_admin(client):
    r = client.get("/admin/api/tags")
    assert r.status_code == 401
    r = client.post("/admin/api/tags", json={"name": "x"})
    assert r.status_code == 401
    r = client.delete("/admin/api/tags/1")
    assert r.status_code == 401
