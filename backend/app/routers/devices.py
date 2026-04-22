"""Admin: list + inspect + mutate devices registered against the panel."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import nulls_last, or_
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..models.user import User
from ..security import utcnow_naive

router = APIRouter(prefix="/admin/api/devices", tags=["admin:devices"])

ONLINE_WINDOW = timedelta(minutes=5)  # device seen within 5 min = online


class DeviceOut(BaseModel):
    id: int
    rustdesk_id: str
    hostname: str | None
    username: str | None
    platform: str | None
    cpu: str | None
    version: str | None
    owner_user_id: int | None
    last_ip: str | None
    last_seen_at: datetime | None
    created_at: datetime
    online: bool

    @classmethod
    def from_model(cls, d: Device, *, now: datetime | None = None) -> DeviceOut:
        _now = now or utcnow_naive()
        online = bool(d.last_seen_at and (_now - d.last_seen_at) < ONLINE_WINDOW)
        data = d.model_dump()
        data["online"] = online
        return cls.model_validate(data)


class DeviceUpdate(BaseModel):
    hostname: str | None = Field(default=None, max_length=128)
    owner_user_id: int | None = Field(default=None)


@router.get("", response_model=list[DeviceOut])
def list_devices(
    session: SessionDep,
    _: AdminUser,
    status_filter: Literal["all", "online", "offline"] = Query("all", alias="status"),
    platform: str | None = Query(default=None, max_length=32),
) -> list[DeviceOut]:
    now = utcnow_naive()
    cutoff = now - ONLINE_WINDOW

    stmt = select(Device)
    if platform:
        stmt = stmt.where(Device.platform == platform)
    if status_filter == "online":
        stmt = stmt.where(Device.last_seen_at >= cutoff)
    elif status_filter == "offline":
        stmt = stmt.where(
            or_(Device.last_seen_at.is_(None), Device.last_seen_at < cutoff)
        )
    stmt = stmt.order_by(nulls_last(Device.last_seen_at.desc()))

    rows = session.exec(stmt).all()
    return [DeviceOut.from_model(d, now=now) for d in rows]


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(device_id: int, session: SessionDep, _: AdminUser) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return DeviceOut.from_model(d)


@router.patch("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    body: DeviceUpdate,
    session: SessionDep,
    admin: AdminUser,
) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    data = body.model_dump(exclude_unset=True)

    # Validate owner_user_id resolves to a real user before we touch the row.
    # Accept `None` (explicit unassignment) but reject unknown ids.
    if "owner_user_id" in data and data["owner_user_id"] is not None:
        owner = session.get(User, data["owner_user_id"])
        if not owner:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "owner_user_id does not match an existing user",
            )

    changed: dict[str, object] = {}
    for k, v in data.items():
        current = getattr(d, k)
        if current != v:
            changed[k] = v
            setattr(d, k, v)

    if not changed:
        # No-op update — return current state without emitting an audit entry
        # so grep-heavy operators don't see phantom events.
        return DeviceOut.from_model(d)

    session.add(d)
    session.add(
        AuditLog(
            action=AuditAction.DEVICE_UPDATED,
            actor_user_id=admin.id,
            from_id=d.rustdesk_id,
            payload=json.dumps({"device_id": device_id, "changes": changed}, default=str),
        )
    )
    session.commit()
    session.refresh(d)
    return DeviceOut.from_model(d)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def forget_device(device_id: int, session: SessionDep, admin: AdminUser) -> None:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    rd_id = d.rustdesk_id
    session.delete(d)
    session.add(
        AuditLog(
            action=AuditAction.DEVICE_FORGOTTEN,
            actor_user_id=admin.id,
            from_id=rd_id,
            payload=json.dumps({"device_id": device_id, "rustdesk_id": rd_id}),
        )
    )
    session.commit()


@router.post("/{device_id}/disconnect", status_code=status.HTTP_202_ACCEPTED)
def request_disconnect(device_id: int, session: SessionDep, admin: AdminUser) -> dict:
    """Stub disconnect — emits an audit event regardless of whether the row
    exists. The real hbbr-side disconnect is a future F5 milestone.

    Idempotent: repeated calls simply produce additional audit entries (which
    is what ops wants — every "please kill it" is on the record).
    """
    d = session.get(Device, device_id)
    rd_id = d.rustdesk_id if d else None
    session.add(
        AuditLog(
            action=AuditAction.DEVICE_DISCONNECT_REQUESTED,
            actor_user_id=admin.id,
            from_id=rd_id,
            payload=json.dumps({"device_id": device_id, "rustdesk_id": rd_id}),
        )
    )
    session.commit()
    return {
        "ok": True,
        "note": "Disconnect requested. hbbr does not yet expose a kill endpoint; "
        "this action is logged for audit.",
    }
