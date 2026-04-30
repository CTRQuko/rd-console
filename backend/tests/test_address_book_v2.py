"""/api/ab/v2 — Group + Contact CRUD."""

from __future__ import annotations

import json

from app.models.address_book import AddressBook
from app.models.address_book_v2 import AbContact, AbGroup


def _login(client, username: str, password: str = "correct-horse-battery") -> str:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_groups_starts_empty(client, admin_token):
    r = client.get("/api/ab/v2/groups", headers=_hdr(admin_token))
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_list_group(client, admin_token):
    r = client.post(
        "/api/ab/v2/groups",
        json={"name": "Soporte", "color": "green"},
        headers=_hdr(admin_token),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Soporte"
    assert body["color"] == "green"
    assert body["contact_count"] == 0
    # GET reflects it.
    listed = client.get("/api/ab/v2/groups", headers=_hdr(admin_token)).json()
    assert any(g["id"] == body["id"] for g in listed)


def test_patch_group_updates_fields(client, admin_token):
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "Old", "color": "blue"},
        headers=_hdr(admin_token),
    ).json()
    r = client.patch(
        f"/api/ab/v2/groups/{g['id']}",
        json={"name": "New", "color": "rose"},
        headers=_hdr(admin_token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "New"
    assert body["color"] == "rose"


def test_delete_group_cascades_contacts(client, admin_token, session):
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "Temp"},
        headers=_hdr(admin_token),
    ).json()
    client.post(
        f"/api/ab/v2/groups/{g['id']}/contacts",
        json={"rd_id": "1", "alias": "one"},
        headers=_hdr(admin_token),
    )
    client.post(
        f"/api/ab/v2/groups/{g['id']}/contacts",
        json={"rd_id": "2", "alias": "two"},
        headers=_hdr(admin_token),
    )
    # Delete the group; both contacts should disappear.
    r = client.delete(f"/api/ab/v2/groups/{g['id']}", headers=_hdr(admin_token))
    assert r.status_code == 204
    remaining = session.exec(
        AbContact.__table__.select().where(AbContact.group_id == g["id"])
    ).all()
    assert remaining == []


def test_create_contact_persists(client, admin_token, session):
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "Devs"},
        headers=_hdr(admin_token),
    ).json()
    r = client.post(
        f"/api/ab/v2/groups/{g['id']}/contacts",
        json={
            "rd_id": "100 200 300",
            "alias": "build-srv",
            "username": "ci",
            "platform": "Ubuntu",
            "tags": ["servers", "ci"],
        },
        headers=_hdr(admin_token),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["rd_id"] == "100 200 300"
    assert body["tags"] == ["servers", "ci"]
    # Tags stored as JSON in DB.
    row = session.get(AbContact, body["id"])
    assert row is not None
    assert json.loads(row.tags) == ["servers", "ci"]


def test_patch_contact(client, admin_token):
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "QA"},
        headers=_hdr(admin_token),
    ).json()
    c = client.post(
        f"/api/ab/v2/groups/{g['id']}/contacts",
        json={"rd_id": "999", "alias": "old-alias"},
        headers=_hdr(admin_token),
    ).json()
    r = client.patch(
        f"/api/ab/v2/contacts/{c['id']}",
        json={"alias": "new-alias", "tags": ["qa"]},
        headers=_hdr(admin_token),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["alias"] == "new-alias"
    assert body["tags"] == ["qa"]


def test_delete_contact(client, admin_token):
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "Z"},
        headers=_hdr(admin_token),
    ).json()
    c = client.post(
        f"/api/ab/v2/groups/{g['id']}/contacts",
        json={"rd_id": "x"},
        headers=_hdr(admin_token),
    ).json()
    r = client.delete(f"/api/ab/v2/contacts/{c['id']}", headers=_hdr(admin_token))
    assert r.status_code == 204
    listed = client.get(
        f"/api/ab/v2/groups/{g['id']}/contacts", headers=_hdr(admin_token)
    ).json()
    assert listed == []


def test_other_user_cannot_see_my_groups(client, admin_token, make_user):
    make_user(username="bob", password="correct-horse-battery")
    bob_token = _login(client, "bob")
    client.post(
        "/api/ab/v2/groups",
        json={"name": "Mine"},
        headers=_hdr(admin_token),
    )
    bob_groups = client.get("/api/ab/v2/groups", headers=_hdr(bob_token)).json()
    # Admin's group must not surface to bob.
    assert all(g["name"] != "Mine" for g in bob_groups)


def test_other_user_cannot_modify_my_group(client, admin_token, make_user):
    make_user(username="carla", password="correct-horse-battery")
    carla_token = _login(client, "carla")
    g = client.post(
        "/api/ab/v2/groups",
        json={"name": "Private"},
        headers=_hdr(admin_token),
    ).json()
    # Carla tries to patch.
    r = client.patch(
        f"/api/ab/v2/groups/{g['id']}",
        json={"name": "Hijacked"},
        headers=_hdr(carla_token),
    )
    assert r.status_code == 404


def test_import_blob_creates_groups(client, admin_token, session, admin_user):
    """If the user has a v1 blob and no v2 rows yet, the first GET
    auto-imports."""
    blob = {
        "tags": ["personal", "ci"],
        "tag_colors": {},
        "peers": [
            {"id": "111", "alias": "macbook", "username": "alex", "tags": ["personal"]},
            {"id": "222", "alias": "build-srv", "username": "ci", "tags": ["ci"]},
        ],
    }
    session.add(AddressBook(user_id=admin_user.id, data=json.dumps(blob)))
    session.commit()

    listed = client.get("/api/ab/v2/groups", headers=_hdr(admin_token)).json()
    names = {g["name"] for g in listed}
    assert "personal" in names
    assert "ci" in names

    # Second call is idempotent — no new groups are added.
    again = client.get("/api/ab/v2/groups", headers=_hdr(admin_token)).json()
    assert {g["id"] for g in again} == {g["id"] for g in listed}


def test_groups_require_auth(client):
    assert client.get("/api/ab/v2/groups").status_code == 401
