"""DELETE /admin/api/logs — soft-delete with guardrails.

Covers:
  - happy path single + bulk
  - retention floor (<30d rows rejected)
  - self-audit protection (LOGS_DELETED row is un-deletable)
  - idempotent (already_deleted skipped, not re-audited)
  - GET list filters out soft-deleted rows
  - admin-only access
  - cap 500 ids per request
"""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import select

from app.models.audit_log import AuditAction, AuditLog
from app.security import utcnow_naive


def _seed(session, *, action=AuditAction.LOGIN, age_days: int = 60, payload: str = "seed"):
    row = AuditLog(
        action=action,
        actor_user_id=None,
        payload=payload,
        created_at=utcnow_naive() - timedelta(days=age_days),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def test_delete_single_row(client, auth_headers, session):
    row = _seed(session, age_days=60)
    r = client.request(
        "DELETE",
        "/admin/api/logs",
        headers=auth_headers,
        json={"ids": [row.id]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 1
    assert body["skipped"] == []
    # The row gets a deleted_at stamp, not an actual delete.
    session.expunge_all()
    hit = session.get(AuditLog, row.id)
    assert hit is not None and hit.deleted_at is not None


def test_list_filters_out_soft_deleted(client, auth_headers, session):
    _seed(session, age_days=60, payload="kept")
    gone = _seed(session, age_days=60, payload="gone")
    client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [gone.id]},
    )
    r = client.get("/admin/api/logs", headers=auth_headers)
    assert r.status_code == 200
    payloads = {row["payload"] for row in r.json()["items"]}
    assert "kept" in payloads
    assert "gone" not in payloads


def test_delete_respects_30d_retention(client, auth_headers, session):
    recent = _seed(session, age_days=5)
    r = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [recent.id]},
    )
    body = r.json()
    assert body["affected"] == 0
    assert body["skipped"][0] == {"id": recent.id, "reason": "within_retention"}


def test_delete_skips_self_audit_rows(client, auth_headers, session):
    # Simulate a historical LOGS_DELETED entry.
    protected = _seed(session, action=AuditAction.LOGS_DELETED, age_days=60)
    r = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [protected.id]},
    )
    body = r.json()
    assert body["affected"] == 0
    assert body["skipped"][0] == {"id": protected.id, "reason": "self_audit_protected"}


def test_delete_is_idempotent(client, auth_headers, session):
    row = _seed(session, age_days=60)
    # First call removes.
    r1 = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [row.id]},
    )
    assert r1.json()["affected"] == 1
    # Second call skips (already_deleted) without erroring.
    r2 = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [row.id]},
    )
    body = r2.json()
    assert body["affected"] == 0
    assert body["skipped"][0]["reason"] == "already_deleted"


def test_delete_writes_self_audit_only_when_something_changed(
    client, auth_headers, session,
):
    row = _seed(session, age_days=60)
    client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [row.id]},
    )
    audits = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.LOGS_DELETED)
    ).all()
    assert len(audits) == 1
    assert str(row.id) in (audits[0].payload or "")

    # No-op delete (retention-blocked) must NOT create a spurious audit.
    recent = _seed(session, age_days=1)
    client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [recent.id]},
    )
    audits_after = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.LOGS_DELETED)
    ).all()
    assert len(audits_after) == 1  # still 1 — not 2


def test_delete_bulk_mixed_reasons(client, auth_headers, session):
    old = _seed(session, age_days=60, payload="old")
    new = _seed(session, age_days=1, payload="new")
    r = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": [old.id, new.id, 99999]},
    )
    body = r.json()
    assert body["affected"] == 1
    reasons = {s["id"]: s["reason"] for s in body["skipped"]}
    assert reasons[new.id] == "within_retention"
    assert reasons[99999] == "not_found"


def test_delete_caps_at_500(client, auth_headers):
    r = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers,
        json={"ids": list(range(1, 502))},
    )
    assert r.status_code == 422


def test_delete_rejects_empty_ids(client, auth_headers):
    r = client.request(
        "DELETE", "/admin/api/logs", headers=auth_headers, json={"ids": []},
    )
    assert r.status_code == 422


def test_delete_requires_admin(client, make_user):
    make_user(username="logreg", password="logreg-pass-1234")
    login = client.post(
        "/api/auth/login",
        json={"username": "logreg", "password": "logreg-pass-1234"},
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = client.request(
        "DELETE", "/admin/api/logs", headers=headers, json={"ids": [1]},
    )
    assert r.status_code == 403
