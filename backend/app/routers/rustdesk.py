"""RustDesk client protocol — stubs for the endpoints that the official
RustDesk client hits against the configured "API server".

These need to be fleshed out in F4 (frontend integration / client testing).
Endpoint names/shapes mirror what kingmo888/rustdesk-api-server exposes, since
that's what the client speaks. Everything returns minimal valid responses for
now so the client doesn't explode on connect.

All endpoints here are gated by `require_client_secret` — when the
`RD_CLIENT_SHARED_SECRET` env var is configured, clients must send it in the
`X-RD-Secret` header. When unset, endpoints remain open (opt-in hardening,
backward compatible with existing deployments).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlmodel import select

from ..config import get_settings
from ..deps import ClientSecretDep, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..security import utcnow_naive

router = APIRouter(prefix="/api", tags=["rustdesk-client"])


class HeartbeatPayload(BaseModel):
    id: str  # RustDesk ID
    uuid: str | None = None
    ver: int | None = None
    # additional fields are ignored for now


class SysinfoPayload(BaseModel):
    id: str
    hostname: str | None = None
    username: str | None = None
    os: str | None = None
    cpu: str | None = None
    version: str | None = None
    uuid: str | None = None


def _truncated_payload(payload: dict) -> str:
    """JSON-serialise and hard-cap the payload for persistence."""
    max_bytes = get_settings().max_audit_payload_bytes
    try:
        raw = json.dumps(payload, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        raw = repr(payload)
    if len(raw) > max_bytes:
        raw = raw[: max_bytes - 3] + "..."
    return raw


def _client_ip(request: Request) -> str | None:
    # In Docker/behind-proxy we expose X-Forwarded-For; trust it only if a
    # reverse proxy is in front (operator's responsibility). Fall back to the
    # direct socket.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45] or None
    if request.client:
        return request.client.host[:45]
    return None


@router.post("/heartbeat")
def heartbeat(
    body: HeartbeatPayload,
    request: Request,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    """Update last_seen_at on heartbeat. Creates the device row if unknown.

    Uses an upsert to avoid the insert-insert race when two heartbeats for the
    same brand-new rustdesk_id hit the server concurrently.
    """
    now = utcnow_naive()
    ip = _client_ip(request)

    device = session.exec(
        select(Device).where(Device.rustdesk_id == body.id)
    ).first()
    if device is None:
        device = Device(rustdesk_id=body.id, last_seen_at=now, last_ip=ip)
        session.add(device)
        try:
            session.commit()
        except Exception:
            # Race: another worker inserted the same rustdesk_id between the
            # SELECT and INSERT. Roll back and re-read.
            session.rollback()
            device = session.exec(
                select(Device).where(Device.rustdesk_id == body.id)
            ).first()
            if device is None:
                # Truly unexpected — surface as a generic OK to avoid leaking.
                return {"ok": True}
    device.last_seen_at = now
    if ip:
        device.last_ip = ip
    session.add(device)
    session.commit()
    return {"ok": True}


@router.post("/sysinfo")
def sysinfo(
    body: SysinfoPayload,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    device = session.exec(select(Device).where(Device.rustdesk_id == body.id)).first()
    if not device:
        device = Device(rustdesk_id=body.id)
    device.hostname = body.hostname or device.hostname
    device.username = body.username or device.username
    device.platform = body.os or device.platform
    device.cpu = body.cpu or device.cpu
    device.version = body.version or device.version
    device.last_seen_at = utcnow_naive()
    session.add(device)
    session.commit()
    return {"ok": True}


@router.post("/audit/conn")
def audit_conn(
    payload: dict,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    """Connection start/stop events from clients."""
    session.add(
        AuditLog(
            action=AuditAction.CONNECT,
            from_id=str(payload.get("from_id") or payload.get("id") or "")[:32] or None,
            to_id=str(payload.get("to_id") or payload.get("peer_id") or "")[:32] or None,
            ip=str(payload.get("ip") or "")[:45] or None,
            uuid=str(payload.get("uuid") or "")[:64] or None,
            payload=_truncated_payload(payload),
        )
    )
    session.commit()
    return {"ok": True}


@router.post("/audit/file")
def audit_file(
    payload: dict,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    session.add(
        AuditLog(
            action=AuditAction.FILE_TRANSFER,
            from_id=str(payload.get("from_id") or "")[:32] or None,
            to_id=str(payload.get("to_id") or "")[:32] or None,
            payload=_truncated_payload(payload),
        )
    )
    session.commit()
    return {"ok": True}
