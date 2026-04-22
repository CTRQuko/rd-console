"""Authorization: token absence, role enforcement."""

from __future__ import annotations


def test_protected_endpoint_without_token_returns_401(client):
    r = client.get("/admin/api/users")
    assert r.status_code == 401


def test_admin_endpoint_rejects_non_admin(client, make_user):
    make_user(username="eve", password="evepass1234")
    login = client.post(
        "/api/auth/login",
        json={"username": "eve", "password": "evepass1234"},
    )
    assert login.status_code == 200
    tok = login.json()["access_token"]
    r = client.get("/admin/api/users", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403


def test_me_returns_current_user(client, admin_user, auth_headers):
    r = client.get("/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "admin"
    assert body["role"] == "admin"
