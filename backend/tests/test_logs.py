"""Audit log pagination + filtering — regression for len(all()) bug."""

from __future__ import annotations

from datetime import timedelta

from sqlmodel import delete

from app.models.audit_log import AuditAction, AuditLog
from app.security import utcnow_naive


def _seed(session, n: int, action: AuditAction) -> None:
    base = utcnow_naive() - timedelta(seconds=n)
    for i in range(n):
        session.add(AuditLog(action=action, created_at=base + timedelta(seconds=i)))
    session.commit()


def test_logs_pagination_total_and_order(client, session, auth_headers):
    # auth_headers triggers /api/auth/login which persists a LOGIN audit entry.
    # Purge so we assert on an exact seeded count.
    session.exec(delete(AuditLog))
    session.commit()

    _seed(session, 60, AuditAction.LOGIN)
    _seed(session, 60, AuditAction.LOGIN_FAILED)

    # Filter to LOGIN only, page size 50, offset 50 → 10 rows left, ordered desc.
    r = client.get(
        "/admin/api/logs?action=login&limit=50&offset=50",
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 60
    assert len(body["items"]) == 10
    timestamps = [i["created_at"] for i in body["items"]]
    assert timestamps == sorted(timestamps, reverse=True)


def test_logs_limit_bounds(client, auth_headers):
    # limit=0 should 422 (ge=1)
    r = client.get("/admin/api/logs?limit=0", headers=auth_headers)
    assert r.status_code == 422
    # limit=501 should 422 (le=500)
    r = client.get("/admin/api/logs?limit=501", headers=auth_headers)
    assert r.status_code == 422
