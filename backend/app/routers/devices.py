"""Admin: list + inspect devices registered against the panel."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.device import Device

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
    def from_model(cls, d: Device) -> "DeviceOut":
        online = bool(d.last_seen_at and datetime.utcnow() - d.last_seen_at < ONLINE_WINDOW)
        data = d.model_dump()
        data["online"] = online
        return cls.model_validate(data)


@router.get("", response_model=list[DeviceOut])
def list_devices(
    session: SessionDep,
    _: AdminUser,
    status_filter: Literal["all", "online", "offline"] = Query("all", alias="status"),
    platform: str | None = None,
) -> list[DeviceOut]:
    stmt = select(Device)
    if platform:
        stmt = stmt.where(Device.platform == platform)
    rows = session.exec(stmt.order_by(Device.last_seen_at.desc())).all()
    out = [DeviceOut.from_model(d) for d in rows]
    if status_filter == "online":
        out = [d for d in out if d.online]
    elif status_filter == "offline":
        out = [d for d in out if not d.online]
    return out


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(device_id: int, session: SessionDep, _: AdminUser) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return DeviceOut.from_model(d)
