"""Tests for /admin/api/logs (v2) — filters + export + device scoping."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session, delete

from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device


def _reset_audit_log(session: Session) -> None:
    """Remove the LOGIN row that the auth_headers fixture writes when the
    admin signs in. Tests that count the entire audit log (no action/category
    filter) would otherwise be off-by-one against the seeded fixtures."""
    session.exec(delete(AuditLog))
    session.commit()


def _seed_log(
    session: Session,
    *,
    action: AuditAction,
    actor_user_id: int | None = None,
    from_id: str | None = None,
    to_id: str | None = None,
    created_at: datetime | None = None,
    payload: str | None = None,
) -> AuditLog:
    row = AuditLog(
        action=action,
        actor_user_id=actor_user_id,
        from_id=from_id,
        to_id=to_id,
        created_at=created_at or datetime.utcnow(),
        payload=payload,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def test_list_logs_filters_by_action(client, auth_headers, session):
    _seed_log(session, action=AuditAction.CONNECT, from_id="a")
    _seed_log(session, action=AuditAction.LOGIN, actor_user_id=None)

    r = client.get("/admin/api/logs?action=connect", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["action"] == "connect"


def test_list_logs_filters_by_category(client, auth_headers, session):
    _seed_log(session, action=AuditAction.CONNECT)
    _seed_log(session, action=AuditAction.LOGIN)
    _seed_log(session, action=AuditAction.USER_CREATED)
    _seed_log(session, action=AuditAction.DEVICE_UPDATED)

    r = client.get("/admin/api/logs?category=config", headers=auth_headers)
    assert r.status_code == 200, r.text
    actions = {i["action"] for i in r.json()["items"]}
    assert actions == {"device_updated"}

    r = client.get("/admin/api/logs?category=session", headers=auth_headers)
    assert {i["action"] for i in r.json()["items"]} == {"connect"}


def test_list_logs_unknown_category_400(client, auth_headers, session):
    r = client.get("/admin/api/logs?category=bogus", headers=auth_headers)
    # Pydantic/FastAPI will 422 on the literal validation before reaching our
    # handler. Accept either — the contract is "not 200".
    assert r.status_code in (400, 422)


def test_list_logs_actor_username_resolves_to_user_id(
    client, auth_headers, session, admin_user, make_user
):
    other = make_user(username="somebody")
    _seed_log(session, action=AuditAction.USER_CREATED, actor_user_id=admin_user.id)
    _seed_log(session, action=AuditAction.USER_UPDATED, actor_user_id=other.id)

    r = client.get("/admin/api/logs?actor=somebody", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["actor_username"] == "somebody"
    assert items[0]["action"] == "user_updated"


def test_list_logs_actor_free_text_matches_rustdesk_id(client, auth_headers, session):
    _seed_log(session, action=AuditAction.CONNECT, from_id="111 222 333")
    _seed_log(session, action=AuditAction.CONNECT, from_id="999 999 999")

    r = client.get("/admin/api/logs?actor=111 222 333", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["from_id"] == "111 222 333"


def test_list_logs_device_id_scopes_by_rustdesk_id(client, auth_headers, session):
    d = Device(rustdesk_id="555 111 000", last_seen_at=datetime.utcnow())
    session.add(d)
    session.commit()
    session.refresh(d)

    _seed_log(session, action=AuditAction.CONNECT, from_id="555 111 000", to_id="x")
    _seed_log(session, action=AuditAction.CONNECT, from_id="other", to_id="555 111 000")
    _seed_log(session, action=AuditAction.CONNECT, from_id="unrelated", to_id="also-unrelated")

    r = client.get(f"/admin/api/logs?device_id={d.id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] == 2


def test_list_logs_device_id_unknown_404(client, auth_headers, session):
    r = client.get("/admin/api/logs?device_id=424242", headers=auth_headers)
    assert r.status_code == 404


def test_list_logs_since_until(client, auth_headers, session):
    _reset_audit_log(session)
    now = datetime.utcnow()
    _seed_log(session, action=AuditAction.LOGIN, created_at=now - timedelta(days=10))
    _seed_log(session, action=AuditAction.LOGIN, created_at=now - timedelta(days=1))

    since = (now - timedelta(days=2)).isoformat()
    r = client.get(f"/admin/api/logs?since={since}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["total"] == 1


def test_list_logs_pagination(client, auth_headers, session):
    _reset_audit_log(session)
    for i in range(7):
        _seed_log(
            session,
            action=AuditAction.CONNECT,
            created_at=datetime.utcnow() - timedelta(seconds=i),
        )

    r = client.get("/admin/api/logs?limit=3&offset=0", headers=auth_headers)
    page1 = r.json()
    assert page1["total"] == 7
    assert len(page1["items"]) == 3

    r = client.get("/admin/api/logs?limit=3&offset=3", headers=auth_headers)
    page2 = r.json()
    assert len(page2["items"]) == 3
    # Pages do not overlap.
    ids1 = {i["id"] for i in page1["items"]}
    ids2 = {i["id"] for i in page2["items"]}
    assert ids1.isdisjoint(ids2)


def test_list_logs_includes_actor_username(client, auth_headers, session, admin_user):
    _seed_log(session, action=AuditAction.LOGIN, actor_user_id=admin_user.id)
    r = client.get("/admin/api/logs", headers=auth_headers)
    item = r.json()["items"][0]
    assert item["actor_username"] == "admin"


def test_export_csv_has_header_and_rows(client, auth_headers, session, admin_user):
    _reset_audit_log(session)
    _seed_log(
        session,
        action=AuditAction.USER_CREATED,
        actor_user_id=admin_user.id,
        payload='{"hello":"world"}',
    )
    _seed_log(session, action=AuditAction.CONNECT, from_id="555")

    r = client.get("/admin/api/logs?format=csv", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"].startswith("attachment")
    text = r.text
    # Header
    assert text.splitlines()[0] == (
        "id,created_at,action,actor_user_id,actor_username,from_id,to_id,ip,uuid,payload"
    )
    # 1 header + 2 data rows
    assert len(text.strip().splitlines()) == 3
    assert "admin" in text
    assert "user_created" in text


def test_export_ndjson_emits_one_json_per_line(client, auth_headers, session):
    _reset_audit_log(session)
    _seed_log(session, action=AuditAction.CONNECT, from_id="a")
    _seed_log(session, action=AuditAction.DISCONNECT, from_id="b")

    r = client.get("/admin/api/logs?format=ndjson", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/x-ndjson")
    lines = [line for line in r.text.splitlines() if line.strip()]
    assert len(lines) == 2
    import json as _json

    rows = [_json.loads(line) for line in lines]
    actions = {r["action"] for r in rows}
    assert actions == {"connect", "disconnect"}


def test_export_applies_same_filters(client, auth_headers, session):
    _seed_log(session, action=AuditAction.CONNECT, from_id="a")
    _seed_log(session, action=AuditAction.LOGIN)

    r = client.get(
        "/admin/api/logs?category=session&format=csv", headers=auth_headers
    )
    assert r.status_code == 200
    # Header + 1 row only.
    assert len(r.text.strip().splitlines()) == 2
    assert "login" not in r.text


def test_logs_endpoints_require_auth(client):
    r = client.get("/admin/api/logs")
    assert r.status_code == 401
    r = client.get("/admin/api/logs?format=csv")
    assert r.status_code == 401
