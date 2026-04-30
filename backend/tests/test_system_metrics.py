"""Tests for /api/v1/system/throughput — backed by SystemMetricSample rows."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import Session

from app.models.system_metric import SystemMetricSample


def _add_sample(session: Session, *, when: datetime, bytes_in: int, bytes_out: int) -> None:
    session.add(
        SystemMetricSample(sampled_at=when, bytes_in=bytes_in, bytes_out=bytes_out)
    )
    session.commit()


def test_throughput_empty_returns_zero_buckets(client, auth_headers):
    """No samples in the DB → 60 zero buckets, max_bps clamped to 1."""
    r = client.get("/api/v1/system/throughput?window=60m", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["in"]) == 60
    assert len(body["out"]) == 60
    assert all(v == 0 for v in body["in"])
    assert all(v == 0 for v in body["out"])
    # max_bps is clamped to 1 so the chart's y-scale doesn't divide by zero.
    assert body["max_bps"] == 1


def test_throughput_two_samples_produce_one_nonzero_bucket(client, auth_headers, session):
    """Two samples 60 s apart yield a single rate that lands in the most
    recent bucket (index 59 of a 60-bucket / 60-min window)."""
    now = datetime.utcnow()
    # 60 s apart, 600 KB increase in/300 KB out → 10 KB/s in, 5 KB/s out
    _add_sample(session, when=now - timedelta(seconds=90), bytes_in=1_000_000, bytes_out=500_000)
    _add_sample(session, when=now - timedelta(seconds=30), bytes_in=1_600_000, bytes_out=800_000)

    r = client.get("/api/v1/system/throughput?window=60m", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    nonzero_in = [(i, v) for i, v in enumerate(body["in"]) if v > 0]
    nonzero_out = [(i, v) for i, v in enumerate(body["out"]) if v > 0]
    assert len(nonzero_in) == 1
    assert len(nonzero_out) == 1
    # Rate is 600_000 bytes / 60 s = 10_000 bytes/s; max_bps reflects the
    # higher of the two (in this case `in`).
    assert nonzero_in[0][1] == 10_000
    assert nonzero_out[0][1] == 5_000
    assert body["max_bps"] == 10_000


def test_throughput_single_sample_yields_no_rate(client, auth_headers, session):
    """A single sample can't produce a rate (need 2 to diff). All buckets stay 0."""
    _add_sample(
        session,
        when=datetime.utcnow() - timedelta(seconds=10),
        bytes_in=999,
        bytes_out=999,
    )
    r = client.get("/api/v1/system/throughput?window=60m", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert all(v == 0 for v in body["in"])
    assert all(v == 0 for v in body["out"])


def test_throughput_clock_skew_skipped(client, auth_headers, session):
    """If a later row has a *smaller* counter than the previous (e.g. boot
    counter wrapped, or NTP corrected backward), the rate would be negative.
    The router clamps to 0 and the bucket stays empty rather than spiking."""
    now = datetime.utcnow()
    _add_sample(session, when=now - timedelta(seconds=120), bytes_in=2_000_000, bytes_out=2_000_000)
    _add_sample(session, when=now - timedelta(seconds=60), bytes_in=1_000_000, bytes_out=1_000_000)

    r = client.get("/api/v1/system/throughput?window=60m", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    # max(0, negative) = 0, so the bucket stays empty.
    assert all(v == 0 for v in body["in"])
    assert all(v == 0 for v in body["out"])


def test_throughput_requires_admin(client):
    """Anonymous request is rejected (401), not just empty."""
    r = client.get("/api/v1/system/throughput?window=60m")
    assert r.status_code == 401


# ─── /api/v1/ws/stats — live WebSocket push ─────────────────────────────────


def test_ws_stats_rejects_missing_token(client):
    """No `?token=…` query param → close with code 4001 before accept."""
    from starlette.websockets import WebSocketDisconnect
    import pytest as _pytest
    with _pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/ws/stats"):
            pass
    assert exc.value.code == 4001


def test_ws_stats_rejects_invalid_token(client):
    """Garbled JWT → 4001."""
    from starlette.websockets import WebSocketDisconnect
    import pytest as _pytest
    with _pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/ws/stats?token=not-a-jwt"):
            pass
    assert exc.value.code == 4001


def test_ws_stats_pushes_first_payload(client, admin_token):
    """Happy path: a valid token receives a metrics payload immediately
    on connect (the loop sends one frame before the first sleep)."""
    with client.websocket_connect(
        f"/api/v1/ws/stats?token={admin_token}"
    ) as ws:
        payload = ws.receive_json()
    assert "cpu" in payload
    assert "memory" in payload
    assert "sessions_active" in payload
    assert "bandwidth_bps" in payload
    assert isinstance(payload["cpu"]["pct"], (int, float))


# ─── /api/v1/ws/notifications — live WebSocket push ─────────────────────────


def test_ws_notifications_rejects_missing_token(client):
    """No `?token=…` query param → close 4001 before accept."""
    from starlette.websockets import WebSocketDisconnect
    import pytest as _pytest
    with _pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/ws/notifications"):
            pass
    assert exc.value.code == 4001


def test_ws_notifications_rejects_invalid_token(client):
    """Garbled JWT → 4001."""
    from starlette.websockets import WebSocketDisconnect
    import pytest as _pytest
    with _pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(
            "/api/v1/ws/notifications?token=not-a-jwt"
        ):
            pass
    assert exc.value.code == 4001


def test_ws_notifications_pushes_first_payload(client, admin_token):
    """Happy path: a valid token receives a notifications payload
    immediately on connect (the loop sends one frame before the first
    sleep). The payload shape mirrors GET /notifications/recent."""
    with client.websocket_connect(
        f"/api/v1/ws/notifications?token={admin_token}"
    ) as ws:
        payload = ws.receive_json()
    assert "items" in payload
    assert "unread_count" in payload
    assert isinstance(payload["items"], list)
    assert isinstance(payload["unread_count"], int)


def test_ws_notifications_payload_matches_http(client, admin_token, session):
    """The WS payload should match what GET /notifications/recent returns
    at the same instant — both call compute_notifications under the hood,
    so any drift here means the helper isn't being shared correctly."""
    # Generate a couple of audit rows so the payload isn't empty.
    from app.models.audit_log import AuditLog, AuditAction
    from datetime import datetime
    session.add(
        AuditLog(
            actor_user_id=None,
            action=AuditAction.LOGIN_FAILED,
            ip="1.2.3.4",
            created_at=datetime.utcnow(),
        )
    )
    session.commit()

    http = client.get(
        "/api/v1/notifications/recent?limit=20",
        headers={"Authorization": f"Bearer {admin_token}"},
    ).json()

    with client.websocket_connect(
        f"/api/v1/ws/notifications?token={admin_token}"
    ) as ws:
        ws_payload = ws.receive_json()

    # Same shape; ids should match the most recent items.
    assert ws_payload["unread_count"] == http["unread_count"]
    http_ids = [item["id"] for item in http["items"]]
    ws_ids = [item["id"] for item in ws_payload["items"]]
    assert http_ids == ws_ids
