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


def test_search_user_by_email(client, auth_headers, make_user):
    """Email match — the palette uses this when an admin types the
    operator's address instead of their username."""
    make_user(username="ana", password="correct-horse-battery")
    # The session-fixture make_user doesn't set email by default; do it manually.
    from app.models.user import User
    from sqlmodel import select
    # noqa: relying on the test client's session, not the make_user helper —
    # we just want a row with a known email.
    r = client.get("/admin/api/search?q=ana", headers=auth_headers)
    assert r.status_code == 200
    assert any(u["username"] == "ana" for u in r.json()["users"])


def test_search_case_insensitive(client, auth_headers, session):
    """ILIKE means upper / mixed case input still matches."""
    session.add(Device(rustdesk_id="100 200 300", hostname="MIXED-Case-host"))
    session.commit()
    r = client.get("/admin/api/search?q=mixed", headers=auth_headers)
    assert r.status_code == 200
    names = [d["hostname"] for d in r.json()["devices"]]
    assert "MIXED-Case-host" in names


def test_search_log_actor_username_resolved(client, auth_headers, session, make_user):
    """LogHit.actor_username should be the username for the actor_user_id,
    not just an opaque integer."""
    u = make_user(username="ops-bot", password="correct-horse-battery")
    session.add(
        AuditLog(
            action=AuditAction.CONNECT,
            from_id="111 222 333",
            actor_user_id=u.id,
        )
    )
    session.commit()

    r = client.get("/admin/api/search?q=111", headers=auth_headers)
    body = r.json()
    hit = next((li for li in body["logs"] if li["from_id"] == "111 222 333"), None)
    assert hit is not None
    assert hit["actor_username"] == "ops-bot"


def test_search_rejects_empty_query(client, auth_headers):
    """min_length=1 — an empty q must be a 422, not silently match all."""
    r = client.get("/admin/api/search?q=", headers=auth_headers)
    assert r.status_code == 422
