"""Health-check endpoints for the RustDesk relay backing this panel.

These endpoints exist to answer the most common "why is my panel empty?"
question operators hit: *are the relay processes even reachable?*

  * `GET /admin/api/health/hbbs` — admin-only TCP probe of the four
    RustDesk server ports (21115 NAT test, 21116 rendezvous, 21117 hbbr
    relay, 21118 websocket) plus the most recent device heartbeat we
    know about. Runs all probes in parallel via a small threadpool so
    the total response stays bounded at ~3s even if a port is timing
    out.

The endpoint is under the admin namespace because:
  (a) it triggers outbound network I/O — an unauthenticated endpoint
      there could be abused to scan a private network.
  (b) the diagnostic value is operator-only; a regular `User` has no
      business knowing whether the relay port is up.
"""

from __future__ import annotations

import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from ..config import get_settings
from ..deps import AdminUser, SessionDep
from ..models.device import Device
from ..security import utcnow_naive

router = APIRouter(prefix="/admin/api/health", tags=["admin:health"])

# Ports to probe. Kept as a module-level tuple so tests can see the full
# expected set. `core` → counted toward the `healthy` summary; `relay` is
# informational (hbbr outage doesn't affect hbbs online status).
_HBBS_CORE_PORTS: tuple[int, ...] = (21115, 21116, 21118)
_HBBR_RELAY_PORT: int = 21117
_ALL_PORTS: tuple[int, ...] = (*_HBBS_CORE_PORTS, _HBBR_RELAY_PORT)

# TCP connect timeout per probe. 3s is enough to distinguish "firewall is
# blackholing packets" (→ timeout) from "service not listening" (→ quick
# RST / ConnectionRefusedError). We run probes in parallel so total latency
# is max(per-probe), not sum.
_PROBE_TIMEOUT_SECONDS: float = 3.0


# ─── Response models ────────────────────────────────────────────────────────


class PortProbe(BaseModel):
    port: int
    ok: bool
    # Free-text reason on failure ("timeout", "connection refused", or the
    # stringified exception for anything else). Empty string on success.
    error: str = ""
    # Informational label so the frontend can render "21115 (NAT test)"
    # without duplicating the port-role mapping there.
    role: Literal["hbbs", "hbbr"]


class HbbsHealth(BaseModel):
    host: str
    ports: list[PortProbe]
    # Derived: True iff the three hbbs core ports respond. hbbr being down
    # doesn't flip this false — hbbr only matters for relayed sessions.
    healthy: bool
    # ISO8601 UTC of the most recent device last_seen_at, or None if zero
    # devices have ever heartbeat'd.
    last_heartbeat_at: str | None
    last_heartbeat_ago_seconds: int | None


# ─── Probe logic ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _ProbeResult:
    port: int
    ok: bool
    error: str


def _probe_tcp(host: str, port: int) -> _ProbeResult:
    """Blocking TCP connect with bounded timeout. Returns a structured
    result rather than raising — caller wants one row per port regardless
    of individual failure mode."""
    try:
        sock = socket.create_connection((host, port), timeout=_PROBE_TIMEOUT_SECONDS)
    except (TimeoutError, socket.timeout):
        return _ProbeResult(port=port, ok=False, error="timeout")
    except ConnectionRefusedError:
        return _ProbeResult(port=port, ok=False, error="connection refused")
    except OSError as exc:
        # Covers DNS failures, network unreachable, etc. Surface the short
        # form so the UI can render something useful without dumping a
        # 200-char traceback.
        return _ProbeResult(port=port, ok=False, error=str(exc)[:120] or "unreachable")
    try:
        sock.close()
    except Exception:  # noqa: BLE001 - close is best-effort
        pass
    return _ProbeResult(port=port, ok=True, error="")


# ─── Route ─────────────────────────────────────────────────────────────────


@router.get("/hbbs", response_model=HbbsHealth)
def hbbs_health(session: SessionDep, _: AdminUser) -> HbbsHealth:
    s = get_settings()
    host = s.server_host.strip()
    if not host:
        # Can't probe an unset host. 503 + a message the UI can display
        # verbatim beats returning a fake "all ok" from localhost.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "RD_SERVER_HOST is not configured — set it in Settings → Server "
            "before running the health check.",
        )

    # Probe all four ports in parallel so total wall time is max(timeouts)
    # rather than sum. Four threads is trivial; no reason to keep the
    # pool around between requests.
    with ThreadPoolExecutor(max_workers=len(_ALL_PORTS)) as pool:
        results = list(pool.map(lambda p: _probe_tcp(host, p), _ALL_PORTS))

    ports = [
        PortProbe(
            port=r.port,
            ok=r.ok,
            error=r.error,
            role="hbbr" if r.port == _HBBR_RELAY_PORT else "hbbs",
        )
        for r in results
    ]
    by_port = {p.port: p for p in ports}
    healthy = all(by_port[p].ok for p in _HBBS_CORE_PORTS)

    # Latest heartbeat we know about. We query max(last_seen_at) rather
    # than ordering + LIMIT 1 so the query plan is trivially fast even on
    # a multi-thousand-device catalogue.
    latest: Device | None = session.exec(
        select(Device)
        .where(Device.last_seen_at.is_not(None))
        .order_by(Device.last_seen_at.desc())
        .limit(1)
    ).first()

    if latest and latest.last_seen_at:
        last_at = latest.last_seen_at
        delta = utcnow_naive() - last_at
        ago = max(0, int(delta.total_seconds()))
        last_at_iso: str | None = last_at.isoformat(timespec="seconds")
        ago_seconds: int | None = ago
    else:
        last_at_iso = None
        ago_seconds = None

    return HbbsHealth(
        host=host,
        ports=ports,
        healthy=healthy,
        last_heartbeat_at=last_at_iso,
        last_heartbeat_ago_seconds=ago_seconds,
    )
