"""/admin/api/search — global union across users, devices, logs."""

from __future__ import annotations

from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device


def test_search_matches_user_by_username(client, auth_headers, make_user):
    make_user(username="jane.doe", password="correct-horse-battery")
    make_user(username="bob", password="correct-horse-battery")

    r = client.get("/admin/api/search?q=jane", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    names = [u["username"] for u in body["users"]]
    assert "jane.doe" in names
    assert "bob" not in names


def test_search_matches_device_by_hostname_or_id(client, auth_headers, session):
    session.add(Device(rustdesk_id="123 456 789", hostname="desktop-alpha"))
    session.add(Device(rustdesk_id="987 654 321", hostname="mbp-beta"))
    session.commit()

    r = client.get("/admin/api/search?q=alpha", headers=auth_headers)
    assert r.status_code == 200
    names = [d["hostname"] for d in r.json()["devices"]]
    assert names == ["desktop-alpha"]

    r = client.get("/admin/api/search?q=123", headers=auth_headers)
    ids = [d["rustdesk_id"] for d in r.json()["devices"]]
    assert "123 456 789" in ids


def test_search_matches_log_by_from_id(client, auth_headers, session):
    session.add(
        AuditLog(
            action=AuditAction.CONNECT, from_id="555 666 777", to_id="888 999 000"
        )
    )
    session.commit()

    r = client.get("/admin/api/search?q=555", headers=auth_headers)
    body = r.json()
    assert len(body["logs"]) >= 1
    assert any(li["from_id"] == "555 666 777" for li in body["logs"])


def test_search_respects_limit(client, auth_headers, session):
    for i in range(15):
        session.add(Device(rustdesk_id=f"id-{i}", hostname=f"host-{i}"))
    session.commit()

    r = client.get("/admin/api/search?q=host&limit=5", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()["devices"]) == 5


def test_search_requires_auth(client):
    r = client.get("/admin/api/search?q=anything")
    assert r.status_code == 401
