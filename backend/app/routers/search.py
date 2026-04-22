"""Admin: global search across users, devices and audit logs.

One endpoint returns a bounded union of matches so the Cmd-K palette can
render them grouped without N round-trips. Each section is limited by
the same `limit` parameter (default 10) so no single match type can
monopolise the result set.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditLog
from ..models.device import Device
from ..models.user import User

router = APIRouter(prefix="/admin/api/search", tags=["admin:search"])


class UserHit(BaseModel):
    id: int
    username: str
    email: str | None


class DeviceHit(BaseModel):
    id: int
    rustdesk_id: str
    hostname: str | None


class LogHit(BaseModel):
    id: int
    action: str
    actor_username: str | None
    from_id: str | None
    to_id: str | None
    created_at: str


class SearchResults(BaseModel):
    users: list[UserHit]
    devices: list[DeviceHit]
    logs: list[LogHit]


@router.get("", response_model=SearchResults)
def global_search(
    session: SessionDep,
    _: AdminUser,
    q: str = Query(min_length=1, max_length=128),
    limit: int = Query(10, ge=1, le=50),
) -> SearchResults:
    like = f"%{q}%"

    # Users: match username or email (case-insensitive via LIKE on LOWER).
    user_rows = session.exec(
        select(User)
        .where(
            or_(
                User.username.ilike(like),
                User.email.ilike(like),
            )
        )
        .limit(limit)
    ).all()
    users = [
        UserHit(id=u.id, username=u.username, email=u.email) for u in user_rows
    ]

    # Devices: match rustdesk_id or hostname.
    device_rows = session.exec(
        select(Device)
        .where(
            or_(
                Device.rustdesk_id.ilike(like),
                Device.hostname.ilike(like),
            )
        )
        .limit(limit)
    ).all()
    devices = [
        DeviceHit(id=d.id, rustdesk_id=d.rustdesk_id, hostname=d.hostname)
        for d in device_rows
    ]

    # Logs: match from_id, to_id, or payload substring. We resolve the actor
    # username via a second pass (cheap — there are at most `limit` rows and
    # the users are already in the identity map by this point).
    log_rows = session.exec(
        select(AuditLog)
        .where(
            or_(
                AuditLog.from_id.ilike(like),
                AuditLog.to_id.ilike(like),
                AuditLog.payload.ilike(like),
            )
        )
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    # Bulk-resolve actor usernames.
    actor_ids = {li.actor_user_id for li in log_rows if li.actor_user_id}
    actors: dict[int, str] = {}
    if actor_ids:
        for u in session.exec(select(User).where(User.id.in_(actor_ids))).all():
            actors[u.id] = u.username
    logs = [
        LogHit(
            id=li.id,
            action=li.action.value,
            actor_username=actors.get(li.actor_user_id) if li.actor_user_id else None,
            from_id=li.from_id,
            to_id=li.to_id,
            created_at=li.created_at.isoformat(),
        )
        for li in log_rows
    ]

    return SearchResults(users=users, devices=devices, logs=logs)
