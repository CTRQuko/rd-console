"""/admin/api/roles — roles + permissions catalogue."""

from __future__ import annotations

import json

import pytest
from sqlmodel import select

from app.models.role import Role
from app.models.user import User, UserRole
from app.routers.roles import bootstrap_roles


@pytest.fixture()
def with_builtin_roles(engine):
    """Seed the builtin roles into the test engine. Tests that check
    counts or `builtin=True` rely on this."""
    bootstrap_roles()
    return None


def test_catalog_returns_groups(client, auth_headers):
    r = client.get("/admin/api/roles/catalog", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert "groups" in body
    # At least one group with at least one item.
    assert body["groups"]
    assert all(g["items"] for g in body["groups"])


def test_list_includes_builtin_roles(client, auth_headers, with_builtin_roles):
    r = client.get("/admin/api/roles", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    ids = {row["id"] for row in body}
    assert "admin" in ids
    assert "user" in ids
    for row in body:
        if row["id"] in {"admin", "user"}:
            assert row["builtin"] is True


def test_create_custom_role(client, auth_headers, with_builtin_roles, session):
    r = client.post(
        "/admin/api/roles",
        json={
            "id": "operator",
            "name": "Operator",
            "description": "Day to day.",
            "permissions": ["devices.read", "devices.edit", "logs.read"],
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] == "operator"
    assert body["builtin"] is False
    assert sorted(body["permissions"]) == ["devices.edit", "devices.read", "logs.read"]
    # Persisted in DB.
    row = session.get(Role, "operator")
    assert row is not None
    assert json.loads(row.permissions) == body["permissions"]


def test_create_rejects_duplicate_id(client, auth_headers, with_builtin_roles):
    r = client.post(
        "/admin/api/roles",
        json={"id": "admin", "name": "Whatever"},
        headers=auth_headers,
    )
    assert r.status_code == 409


def test_create_strips_unknown_permissions(client, auth_headers, with_builtin_roles):
    r = client.post(
        "/admin/api/roles",
        json={
            "id": "halfvalid",
            "name": "Half valid",
            "permissions": ["devices.read", "totally.bogus"],
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    assert r.json()["permissions"] == ["devices.read"]


def test_patch_builtin_cannot_rename(client, auth_headers, with_builtin_roles):
    r = client.patch(
        "/admin/api/roles/admin",
        json={"name": "Super-admin"},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_patch_builtin_can_change_permissions(client, auth_headers, with_builtin_roles, session):
    r = client.patch(
        "/admin/api/roles/user",
        json={"permissions": ["devices.read"]},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["permissions"] == ["devices.read"]


def test_delete_builtin_rejected(client, auth_headers, with_builtin_roles):
    r = client.delete("/admin/api/roles/admin", headers=auth_headers)
    assert r.status_code == 400


def test_delete_custom_role_with_no_members(
    client, auth_headers, with_builtin_roles, session
):
    """Deleting a custom role works cleanly when no users hold it.

    Production User.role is a SQL Enum {admin, user}, so custom roles
    can't actually be assigned to users yet — that's a follow-up that
    needs a User.role schema relax. Until then the reassignment branch
    in delete_role is defensive code (no rows ever match the WHERE).
    """
    r = client.post(
        "/admin/api/roles",
        json={"id": "ops", "name": "Ops"},
        headers=auth_headers,
    )
    assert r.status_code == 201

    r = client.delete("/admin/api/roles/ops", headers=auth_headers)
    assert r.status_code == 204
    # Subsequent GET no longer returns it.
    body = client.get("/admin/api/roles", headers=auth_headers).json()
    assert "ops" not in {row["id"] for row in body}


def test_member_count_reflects_users(client, auth_headers, with_builtin_roles, make_user):
    """`member_count` equals the number of users whose role matches."""
    make_user(username="ana", password="correct-horse-battery", role=UserRole.USER)
    make_user(username="bea", password="correct-horse-battery", role=UserRole.USER)
    r = client.get("/admin/api/roles", headers=auth_headers)
    assert r.status_code == 200
    by_id = {row["id"]: row for row in r.json()}
    # `bea` and `ana` both got UserRole.USER so the count is at least 2.
    assert by_id["user"]["member_count"] >= 2


def test_roles_require_auth(client):
    assert client.get("/admin/api/roles").status_code == 401
    assert client.get("/admin/api/roles/catalog").status_code == 401
