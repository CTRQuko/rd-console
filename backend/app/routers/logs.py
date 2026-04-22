"""Admin: read the audit log."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func
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
    filters = []
    if action is not None:
        filters.append(AuditLog.action == action)
    if since is not None:
        filters.append(AuditLog.created_at >= since)
    if until is not None:
        filters.append(AuditLog.created_at <= until)

    # Count in SQL (O(1) with index on created_at), not by materialising rows.
    count_stmt = select(func.count()).select_from(AuditLog)
    for f in filters:
        count_stmt = count_stmt.where(f)
    total = session.exec(count_stmt).one()

    items_stmt = select(AuditLog)
    for f in filters:
        items_stmt = items_stmt.where(f)
    rows = session.exec(
        items_stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    ).all()

    return Paginated(
        total=int(total),
        items=[AuditLogOut.model_validate(r, from_attributes=True) for r in rows],
    )
