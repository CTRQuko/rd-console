"""hbbs health check: /admin/api/health/hbbs.

Contract:
  * Admin-only. Regular users → 403. No auth → 401.
  * Probes TCP connect to the 4 RustDesk ports at the configured server host:
      - 21115 (NAT test, TCP)
      - 21116 (rendezvous, TCP — also UDP but we only probe TCP)
      - 21117 (hbbr relay, TCP)
      - 21118 (websocket, TCP)
  * Returns per-port status + the last heartbeat timestamp + a summary
    `healthy` flag that's true iff at least 21115/21116/21118 respond.
  * Parallel probes, bounded total wait (~3s).

Tests mock socket.create_connection so the suite stays hermetic.
"""

from __future__ import annotations

import socket
from datetime import timedelta
from unittest.mock import patch

from sqlmodel import select

from app.models.device import Device
from app.security import utcnow_naive


# ─── Auth ────────────────────────────────────────────────────────────────────


def test_hbbs_health_no_auth_returns_401(client):
    r = client.get("/admin/api/health/hbbs")
    assert r.status_code == 401


def test_hbbs_health_non_admin_returns_403(client, make_user):
    make_user(username="bob", password="bob-password-4321")
    token = client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "bob-password-4321"},
    ).json()["access_token"]
    r = client.get(
        "/admin/api/health/hbbs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


# ─── Response shape & host ───────────────────────────────────────────────────


def test_hbbs_health_reports_configured_host(client, auth_headers, monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "rustdeskserver.example")

    # Make all probes succeed with a trivial fake socket.
    with patch("socket.create_connection", return_value=_FakeSock()):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["host"] == "rustdeskserver.example"
    get_settings.cache_clear()


def test_hbbs_health_empty_host_returns_503(client, auth_headers, monkeypatch):
    """If RD_SERVER_HOST isn't configured yet, the probe can't run. We return
    503 with a clear message rather than probing an empty string."""
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "")
    r = client.get("/admin/api/health/hbbs", headers=auth_headers)
    assert r.status_code == 503
    assert "host" in r.json()["detail"].lower()
    get_settings.cache_clear()


# ─── Port probes ─────────────────────────────────────────────────────────────


def test_hbbs_health_probes_all_four_ports(client, auth_headers, monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "h.example")

    seen_ports: list[int] = []

    def _fake(addr, timeout=None):  # noqa: ARG001 - signature parity with stdlib
        seen_ports.append(addr[1])
        return _FakeSock()

    with patch("socket.create_connection", side_effect=_fake):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    assert r.status_code == 200
    assert sorted(seen_ports) == [21115, 21116, 21117, 21118]
    get_settings.cache_clear()


def test_hbbs_health_reports_port_failures(client, auth_headers, monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "h.example")

    def _fake(addr, timeout=None):  # noqa: ARG001
        # Simulate partial outage: 21115 + 21118 alive, 21116 timeout, 21117 refused.
        port = addr[1]
        if port in (21115, 21118):
            return _FakeSock()
        if port == 21116:
            raise TimeoutError("simulated")
        if port == 21117:
            raise ConnectionRefusedError("simulated")
        raise AssertionError(f"unexpected port {port}")

    with patch("socket.create_connection", side_effect=_fake):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    assert r.status_code == 200
    body = r.json()
    by_port = {p["port"]: p for p in body["ports"]}
    assert by_port[21115]["ok"] is True
    assert by_port[21116]["ok"] is False
    assert "timeout" in by_port[21116]["error"].lower()
    assert by_port[21117]["ok"] is False
    assert "refused" in by_port[21117]["error"].lower()
    assert by_port[21118]["ok"] is True
    # Summary: healthy iff hbbs core ports (21115, 21116, 21118) all ok.
    # 21116 is down in this scenario → unhealthy.
    assert body["healthy"] is False
    get_settings.cache_clear()


def test_hbbs_health_healthy_when_core_ports_ok_even_if_relay_down(
    client, auth_headers, monkeypatch
):
    """hbbr (21117) being down stops remote sessions but hbbs IS still serving
    IDs — the panel's 'online' state depends on the hbbs ports only. So the
    healthy flag should only require the hbbs triad."""
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "h.example")

    def _fake(addr, timeout=None):  # noqa: ARG001
        if addr[1] == 21117:
            raise ConnectionRefusedError("relay down")
        return _FakeSock()

    with patch("socket.create_connection", side_effect=_fake):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    body = r.json()
    assert body["healthy"] is True


# ─── Last heartbeat ──────────────────────────────────────────────────────────


def test_hbbs_health_reports_no_heartbeat_yet(client, auth_headers, monkeypatch):
    """Fresh install with zero devices → null last_heartbeat_at."""
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "h.example")

    with patch("socket.create_connection", return_value=_FakeSock()):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    body = r.json()
    assert body["last_heartbeat_at"] is None
    assert body["last_heartbeat_ago_seconds"] is None
    get_settings.cache_clear()


def test_hbbs_health_reports_most_recent_heartbeat(
    client, auth_headers, session, monkeypatch
):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("RD_SERVER_HOST", "h.example")

    # Two devices, the NEWER one should drive last_heartbeat_at.
    now = utcnow_naive()
    session.add(
        Device(rustdesk_id="old", last_seen_at=now - timedelta(hours=5))
    )
    session.add(
        Device(rustdesk_id="recent", last_seen_at=now - timedelta(minutes=3))
    )
    session.commit()

    with patch("socket.create_connection", return_value=_FakeSock()):
        r = client.get("/admin/api/health/hbbs", headers=auth_headers)

    body = r.json()
    assert body["last_heartbeat_at"] is not None
    # ~3 minutes ago = ~180s. Allow slack for test wall-clock drift.
    assert 60 <= body["last_heartbeat_ago_seconds"] <= 600
    get_settings.cache_clear()


# ─── helpers ─────────────────────────────────────────────────────────────────


class _FakeSock:
    """Minimal stand-in for a real socket.socket. We only ever call .close()
    on it from the production path; anything else is a bug in the impl."""

    def close(self) -> None:
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False
