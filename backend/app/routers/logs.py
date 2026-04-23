"""Admin: read the audit log.

v2: category/actor/device_id filters + CSV/NDJSON streaming export.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterator
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AUDIT_CATEGORIES, AuditAction, AuditLog
from ..models.user import User
from ..security import utcnow_naive

router = APIRouter(prefix="/admin/api/logs", tags=["admin:logs"])


class AuditLogOut(BaseModel):
    id: int
    action: AuditAction
    from_id: str | None
    to_id: str | None
    ip: str | None
    uuid: str | None
    actor_user_id: int | None
    actor_username: str | None = None
    payload: str | None
    created_at: datetime


class Paginated(BaseModel):
    total: int
    items: list[AuditLogOut]


_CategoryLiteral = Literal["session", "auth", "user_management", "config"]
_FormatLiteral = Literal["json", "csv", "ndjson"]
_CSV_COLUMNS = (
    "id",
    "created_at",
    "action",
    "actor_user_id",
    "actor_username",
    "from_id",
    "to_id",
    "ip",
    "uuid",
    "payload",
)


def _apply_filters(
    stmt,
    session,
    *,
    action: AuditAction | None,
    category: _CategoryLiteral | None,
    since: datetime | None,
    until: datetime | None,
    actor: str | None,
    device_id: int | None,
):
    """Attach WHERE clauses to a base select(AuditLog) statement.

    Split out so the count + items queries apply exactly the same filters and
    can't drift. Passed `session` so the actor/device_id resolution can do
    lookups without the caller reaching into the router.
    """
    # Soft-deleted rows are invisible by default — the panel should not
    # surface rows an admin already purged. A future hard-delete cron
    # removes them entirely.
    stmt = stmt.where(AuditLog.deleted_at.is_(None))  # type: ignore[attr-defined]

    if action is not None:
        stmt = stmt.where(AuditLog.action == action)

    if category is not None:
        actions = AUDIT_CATEGORIES.get(category)
        if not actions:
            raise HTTPException(400, f"Unknown category: {category}")
        stmt = stmt.where(AuditLog.action.in_(actions))

    if since is not None:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLog.created_at <= until)

    if actor:
        # Resolve "actor" to a panel user first. If the string matches a
        # username, constrain actor_user_id to that user's id. If not, fall
        # back to matching from_id (RustDesk ID) so the UI's free-text search
        # covers both worlds in a single field.
        matched_user = session.exec(
            select(User).where(User.username == actor)
        ).first()
        if matched_user is not None:
            stmt = stmt.where(AuditLog.actor_user_id == matched_user.id)
        else:
            stmt = stmt.where(
                or_(
                    AuditLog.from_id == actor,
                    AuditLog.to_id == actor,
                )
            )

    if device_id is not None:
        # Scope to a device's RustDesk ID (not its numeric DB id). Matches
        # either side of the connection, plus any panel-initiated device
        # action that we annotate with from_id = rustdesk_id.
        from ..models.device import Device  # local import — avoid cycle

        dev = session.get(Device, device_id)
        if dev is None:
            raise HTTPException(404, "Device not found")
        stmt = stmt.where(
            or_(AuditLog.from_id == dev.rustdesk_id, AuditLog.to_id == dev.rustdesk_id)
        )

    return stmt


def _to_out(row: AuditLog, *, username_by_id: dict[int, str]) -> AuditLogOut:
    out = AuditLogOut.model_validate(row, from_attributes=True)
    if row.actor_user_id is not None:
        out.actor_username = username_by_id.get(row.actor_user_id)
    return out


def _usernames_for(session, rows: list[AuditLog]) -> dict[int, str]:
    """Load usernames for the actor_user_ids present in `rows`. One round trip."""
    ids = {r.actor_user_id for r in rows if r.actor_user_id is not None}
    if not ids:
        return {}
    stmt = select(User.id, User.username).where(User.id.in_(ids))
    return {uid: uname for uid, uname in session.exec(stmt).all()}


def _csv_iter(rows: Iterator[AuditLog], username_by_id: dict[int, str]) -> Iterator[str]:
    """Yield CSV text (header + data rows). Wrapped in StreamingResponse.

    We build one row at a time with csv.writer against an in-memory buffer so
    we inherit its quoting rules (payload frequently contains commas) without
    shipping a partially written StringIO back to Starlette.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(_CSV_COLUMNS)
    yield buf.getvalue()
    buf.seek(0)
    buf.truncate()

    for r in rows:
        writer.writerow(
            [
                r.id,
                r.created_at.isoformat() if r.created_at else "",
                r.action.value if isinstance(r.action, AuditAction) else str(r.action),
                r.actor_user_id if r.actor_user_id is not None else "",
                username_by_id.get(r.actor_user_id) if r.actor_user_id is not None else "",
                r.from_id or "",
                r.to_id or "",
                r.ip or "",
                r.uuid or "",
                r.payload or "",
            ]
        )
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate()


def _ndjson_iter(rows: Iterator[AuditLog], username_by_id: dict[int, str]) -> Iterator[str]:
    for r in rows:
        obj = {
            "id": r.id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "action": r.action.value if isinstance(r.action, AuditAction) else str(r.action),
            "actor_user_id": r.actor_user_id,
            "actor_username": username_by_id.get(r.actor_user_id)
            if r.actor_user_id is not None
            else None,
            "from_id": r.from_id,
            "to_id": r.to_id,
            "ip": r.ip,
            "uuid": r.uuid,
            "payload": r.payload,
        }
        yield json.dumps(obj, ensure_ascii=False) + "\n"


@router.get("")
def list_logs(
    session: SessionDep,
    _: AdminUser,
    action: AuditAction | None = None,
    category: _CategoryLiteral | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    actor: str | None = Query(default=None, max_length=64),
    device_id: int | None = None,
    format: _FormatLiteral = "json",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List audit entries with filtering + paging, or stream CSV/NDJSON.

    json → Paginated (default).
    csv / ndjson → StreamingResponse; ignores limit/offset (exports ALL matches).
    """
    base = select(AuditLog)
    base = _apply_filters(
        base,
        session,
        action=action,
        category=category,
        since=since,
        until=until,
        actor=actor,
        device_id=device_id,
    )

    if format in ("csv", "ndjson"):
        rows = session.exec(base.order_by(AuditLog.created_at.desc())).all()
        usernames = _usernames_for(session, rows)
        if format == "csv":
            return StreamingResponse(
                _csv_iter(iter(rows), usernames),
                media_type="text/csv",
                headers={
                    "Content-Disposition": 'attachment; filename="rd-console-audit.csv"'
                },
            )
        return StreamingResponse(
            _ndjson_iter(iter(rows), usernames),
            media_type="application/x-ndjson",
            headers={
                "Content-Disposition": 'attachment; filename="rd-console-audit.ndjson"'
            },
        )

    # JSON / paginated path.
    count_stmt = select(func.count()).select_from(AuditLog)
    count_stmt = _apply_filters(
        count_stmt,
        session,
        action=action,
        category=category,
        since=since,
        until=until,
        actor=actor,
        device_id=device_id,
    )
    total = session.exec(count_stmt).one()

    items_stmt = base.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    rows = session.exec(items_stmt).all()
    usernames = _usernames_for(session, rows)
    return Paginated(
        total=int(total),
        items=[_to_out(r, username_by_id=usernames) for r in rows],
    )


# ─── Soft delete ────────────────────────────────────────────────────────────


class DeleteLogsBody(BaseModel):
    """IDs of log rows to purge. Capped at 500/request so a misclick on
    'select all + delete' can't wipe a year of history in one shot."""
    ids: list[int] = Field(min_length=1, max_length=500)


class DeleteLogsResult(BaseModel):
    affected: int
    skipped: list[dict]  # {id, reason}


# Retention floor (days). Rows younger than this cannot be soft-deleted
# — the goal is that "a thing happened recently" is always findable in
# the log, even if an admin panics and hits Delete. Documented in the
# UI. Keep aligned with the copy there.
_MIN_RETENTION_DAYS = 30


@router.delete("", response_model=DeleteLogsResult)
def delete_logs(
    body: DeleteLogsBody,
    session: SessionDep,
    admin: AdminUser,
) -> DeleteLogsResult:
    """Soft-delete audit rows by id.

    Guardrails:
      * Retention: rows newer than 30 days are NEVER deletable — recent
        activity must stay visible for investigation.
      * Self-shield: the ``LOGS_DELETED`` audit entry that represents the
        purge itself is not delete-target-eligible. An admin cannot hide
        the fact that they deleted things.
      * Cap: max 500 ids per request (enforced at Pydantic level).
      * Idempotent: rows already soft-deleted skip silently with
        reason ``already_deleted`` — retrying a failed batch is safe.
    """
    now = utcnow_naive()
    retention_cutoff = now - _timedelta(days=_MIN_RETENTION_DAYS)

    ids = list(dict.fromkeys(body.ids))  # de-dup, preserve order
    rows = session.exec(
        select(AuditLog).where(AuditLog.id.in_(ids))  # type: ignore[attr-defined]
    ).all()
    found = {r.id: r for r in rows}

    skipped: list[dict] = []
    affected = 0

    def skip(rid: int, reason: str) -> None:
        skipped.append({"id": rid, "reason": reason})

    for rid in ids:
        row = found.get(rid)
        if row is None:
            skip(rid, "not_found")
            continue
        if row.deleted_at is not None:
            skip(rid, "already_deleted")
            continue
        if row.action == AuditAction.LOGS_DELETED:
            # The self-audit of a previous purge is immutable — otherwise
            # an admin could launder a suspicious delete by deleting the
            # record of the delete.
            skip(rid, "self_audit_protected")
            continue
        if row.created_at and row.created_at >= retention_cutoff:
            skip(rid, "within_retention")
            continue
        row.deleted_at = now
        session.add(row)
        affected += 1

    if affected > 0:
        # The payload records the actual IDs purged, not the requested
        # ones — skipped rows don't show up. Capped payload length so a
        # 500-id delete doesn't blow up an arbitrary row string column.
        affected_ids = [rid for rid in ids if rid in found and rid not in {s["id"] for s in skipped}]
        payload = "ids=" + ",".join(str(rid) for rid in affected_ids[:200])
        if len(affected_ids) > 200:
            payload += f",...(+{len(affected_ids) - 200} more)"
        session.add(AuditLog(
            action=AuditAction.LOGS_DELETED,
            actor_user_id=admin.id,
            payload=payload,
        ))

    session.commit()
    return DeleteLogsResult(affected=affected, skipped=skipped)


# local import to keep the top of the module tidy
from datetime import timedelta as _timedelta  # noqa: E402
