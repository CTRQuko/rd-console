"""RustDesk client protocol — stubs for the endpoints that the official
RustDesk client hits against the configured "API server".

These need to be fleshed out in F4 (frontend integration / client testing).
Endpoint names/shapes mirror what kingmo888/rustdesk-api-server exposes, since
that's what the client speaks. Everything returns minimal valid responses for
now so the client doesn't explode on connect.

Reference endpoints (client -> this server):
  POST /api/login                 user login (returns token + user_info)
  GET  /api/currentUser           info about the token holder
  POST /api/logout                invalidate token
  POST /api/audit/conn            connection events
  POST /api/audit/file            file transfer events
  POST /api/heartbeat             device heartbeat
  POST /api/sysinfo               device system info
  GET  /api/ab                    address book fetch
  POST /api/ab                    address book push
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlmodel import select

from ..db import get_session
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from fastapi import Depends

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


@router.post("/heartbeat")
def heartbeat(body: HeartbeatPayload, request: Request, session=Depends(get_session)) -> dict:
    """Update last_seen_at on heartbeat. Creates the device row if unknown."""
    device = session.exec(select(Device).where(Device.rustdesk_id == body.id)).first()
    now = datetime.utcnow()
    if not device:
        device = Device(rustdesk_id=body.id, last_seen_at=now)
    else:
        device.last_seen_at = now
    device.last_ip = request.client.host if request.client else device.last_ip
    session.add(device)
    session.commit()
    return {"ok": True}


@router.post("/sysinfo")
def sysinfo(body: SysinfoPayload, session=Depends(get_session)) -> dict:
    device = session.exec(select(Device).where(Device.rustdesk_id == body.id)).first()
    if not device:
        device = Device(rustdesk_id=body.id)
    device.hostname = body.hostname or device.hostname
    device.username = body.username or device.username
    device.platform = body.os or device.platform
    device.cpu = body.cpu or device.cpu
    device.version = body.version or device.version
    device.last_seen_at = datetime.utcnow()
    session.add(device)
    session.commit()
    return {"ok": True}


@router.post("/audit/conn")
def audit_conn(payload: dict, session=Depends(get_session)) -> dict:
    """Connection start/stop events from clients."""
    session.add(
        AuditLog(
            action=AuditAction.CONNECT,
            from_id=str(payload.get("from_id") or payload.get("id") or "")[:32] or None,
            to_id=str(payload.get("to_id") or payload.get("peer_id") or "")[:32] or None,
            ip=str(payload.get("ip") or "")[:45] or None,
            uuid=str(payload.get("uuid") or "")[:64] or None,
            payload=str(payload),
        )
    )
    session.commit()
    return {"ok": True}


@router.post("/audit/file")
def audit_file(payload: dict, session=Depends(get_session)) -> dict:
    session.add(
        AuditLog(
            action=AuditAction.FILE_TRANSFER,
            from_id=str(payload.get("from_id") or "")[:32] or None,
            to_id=str(payload.get("to_id") or "")[:32] or None,
            payload=str(payload),
        )
    )
    session.commit()
    return {"ok": True}
