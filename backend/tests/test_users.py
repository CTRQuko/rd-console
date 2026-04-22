"""User admin: disable-self guard, last-admin guard."""

from __future__ import annotations

from app.models.user import UserRole


def test_cannot_disable_self(client, admin_user, auth_headers):
    r = client.delete(f"/admin/api/users/{admin_user.id}", headers=auth_headers)
    assert r.status_code == 400


def test_cannot_demote_last_admin(client, admin_user, auth_headers):
    """PATCH role=user on the last admin must fail — regression for F-6."""
    r = client.patch(
        f"/admin/api/users/{admin_user.id}",
        headers=auth_headers,
        json={"role": "user"},
    )
    assert r.status_code == 400


def test_can_demote_admin_if_another_admin_exists(client, admin_user, make_user, auth_headers):
    make_user(username="admin2", password="admin2pass1234", role=UserRole.ADMIN)
    r = client.patch(
        f"/admin/api/users/{admin_user.id}",
        headers=auth_headers,
        json={"role": "user"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "user"


def test_create_user_conflict_on_duplicate_username(client, make_user, auth_headers):
    make_user(username="dup", password="duppppppp")
    r = client.post(
        "/admin/api/users",
        headers=auth_headers,
        json={"username": "dup", "password": "duppppppp"},
    )
    assert r.status_code == 409


def test_create_user_validates_password_length(client, auth_headers):
    r = client.post(
        "/admin/api/users",
        headers=auth_headers,
        json={"username": "newbie", "password": "short"},
    )
    assert r.status_code == 422
