"""Admin: read the audit log."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog

router = APIRouter(prefix="/admin/api/logs", tags=["admin:logs"])


class AuditLogOut(BaseModel):
    id: int
    action: AuditAction
    from_id: str | None
    to_id: str | None
    ip: str | None
    uuid: str | None
    actor_user_id: int | None
    payload: str | None
    created_at: datetime


class Paginated(BaseModel):
    total: int
    items: list[AuditLogOut]


@router.get("", response_model=Paginated)
def list_logs(
    session: SessionDep,
    _: AdminUser,
    action: AuditAction | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Paginated:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until:
        stmt = stmt.where(AuditLog.created_at <= until)

    total = len(session.exec(stmt).all())
    rows = session.exec(
        stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    ).all()
    return Paginated(
        total=total,
        items=[AuditLogOut.model_validate(r, from_attributes=True) for r in rows],
    )
