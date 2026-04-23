"""Admin: CRUD over panel users."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, update
from sqlmodel import delete, select

from ..deps import AdminUser, SessionDep
from ..models.address_book import AddressBook
from ..models.api_token import ApiToken
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..models.join_token import JoinToken
from ..models.user import User, UserRole
from ..security import hash_password

router = APIRouter(prefix="/admin/api/users", tags=["admin:users"])


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    email: EmailStr | None = None
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.USER


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


def _count_active_admins(session, exclude_user_id: int | None = None) -> int:
    stmt = select(func.count()).select_from(User).where(
        User.role == UserRole.ADMIN,
        User.is_active == True,  # noqa: E712 - SQLAlchemy idiom
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return session.exec(stmt).one()


@router.get("", response_model=list[UserOut])
def list_users(session: SessionDep, _: AdminUser) -> list[UserOut]:
    rows = session.exec(select(User).order_by(User.created_at.desc())).all()
    return [UserOut.model_validate(r, from_attributes=True) for r in rows]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, session: SessionDep, admin: AdminUser) -> UserOut:
    if session.exec(select(User).where(User.username == body.username)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists")
    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    session.add(AuditLog(
        action=AuditAction.USER_CREATED,
        actor_user_id=admin.id,
        payload=f"username={body.username}",
    ))
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, session: SessionDep, admin: AdminUser) -> UserOut:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    data = body.model_dump(exclude_unset=True)

    # Guardrail: do not let the caller delete the last active admin by either
    # demoting them or deactivating them.
    demoting = (
        "role" in data
        and data["role"] is not None
        and user.role == UserRole.ADMIN
        and data["role"] != UserRole.ADMIN
    )
    deactivating = (
        "is_active" in data
        and data["is_active"] is False
        and user.role == UserRole.ADMIN
        and user.is_active
    )
    if demoting or deactivating:
        remaining = _count_active_admins(session, exclude_user_id=user.id)
        if remaining == 0:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Cannot demote or deactivate the last active admin",
            )

    if "password" in data and data["password"]:
        user.password_hash = hash_password(data.pop("password"))
    else:
        data.pop("password", None)

    for k, v in data.items():
        setattr(user, k, v)

    session.add(user)
    session.add(AuditLog(
        action=AuditAction.USER_UPDATED,
        actor_user_id=admin.id,
        payload=f"user_id={user_id}",
    ))
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


def _assert_not_last_admin_gone(
    session, *, user: User, action_would_remove_admin: bool,
) -> None:
    """Guardrail used by both disable and hard-delete paths.

    `action_would_remove_admin` is true when the proposed change would take
    an active admin out of the "active admins" set — either by deactivating
    them or by deleting them outright. We want to block it if no other
    active admin remains.
    """
    if not action_would_remove_admin:
        return
    remaining = _count_active_admins(session, exclude_user_id=user.id)
    if remaining == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot remove the last active admin",
        )


def _hard_delete_user(session, *, user: User, actor_user_id: int) -> None:
    """Erase a user and all per-user owned rows in a single transaction.

    Cascade strategy:
      * `api_tokens.user_id` is NOT NULL → DELETE rows.
      * `address_books.user_id` is the PK → DELETE row.
      * `devices.owner_user_id`, `join_tokens.created_by_user_id`,
        `audit_logs.actor_user_id` are nullable → NULL them out. We keep
        the historical rows (audit trail / device records) but anonymise
        the link so a reused user_id never re-attaches stale ownership.

    The delete of the user row itself must happen last so FK checks stay
    happy under `PRAGMA foreign_keys = ON` (SQLite) or the equivalent on
    other engines.
    """
    uid = user.id
    session.exec(delete(ApiToken).where(ApiToken.user_id == uid))
    session.exec(delete(AddressBook).where(AddressBook.user_id == uid))
    session.exec(
        update(Device).where(Device.owner_user_id == uid).values(owner_user_id=None)
    )
    session.exec(
        update(JoinToken)
        .where(JoinToken.created_by_user_id == uid)
        .values(created_by_user_id=None)
    )
    session.exec(
        update(AuditLog).where(AuditLog.actor_user_id == uid).values(actor_user_id=None)
    )
    session.add(
        AuditLog(
            action=AuditAction.USER_DELETED,
            actor_user_id=actor_user_id,
            payload=f"user_id={uid} username={user.username}",
        )
    )
    session.delete(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_or_disable_user(
    user_id: int,
    session: SessionDep,
    admin: AdminUser,
    hard: bool = False,
) -> None:
    """Disable (soft) or permanently delete (hard) a user.

    Default remains the historical behaviour — `DELETE /admin/api/users/{id}`
    flips `is_active = false` and leaves the row. Pass `?hard=true` to
    wipe the account plus its PATs and address book. Devices and audit
    rows are preserved with a NULL owner/actor so history is not lost.

    Guardrails (both modes):
      * You cannot remove yourself.
      * You cannot remove the last active admin.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot remove yourself")

    removes_admin = user.role == UserRole.ADMIN and user.is_active
    _assert_not_last_admin_gone(
        session, user=user, action_would_remove_admin=removes_admin,
    )

    if hard:
        _hard_delete_user(session, user=user, actor_user_id=admin.id)  # type: ignore[arg-type]
        session.commit()
        return

    # Soft-disable path — idempotent.
    if not user.is_active:
        return
    user.is_active = False
    session.add(user)
    session.add(AuditLog(
        action=AuditAction.USER_DISABLED,
        actor_user_id=admin.id,
        payload=f"user_id={user_id}",
    ))
    session.commit()


# ─── Bulk ops ──────────────────────────────────────────────────────────────


BulkAction = Literal["disable", "enable", "delete"]


class BulkUsersBody(BaseModel):
    action: BulkAction
    user_ids: list[int] = Field(min_length=1, max_length=500)


class BulkUsersResult(BaseModel):
    action: BulkAction
    affected: int
    skipped: list[dict]  # {user_id, reason}


@router.post("/bulk", response_model=BulkUsersResult)
def bulk_users(
    body: BulkUsersBody,
    session: SessionDep,
    admin: AdminUser,
) -> BulkUsersResult:
    """Apply an action to a list of user IDs in one transaction.

    Actions:
      * ``disable`` — set is_active=False. No-op on already-disabled rows.
      * ``enable``  — set is_active=True. No-op on already-enabled rows.
      * ``delete``  — permanent hard delete (same semantics as ?hard=true).

    Per-row errors (self-targeting, last-admin, not found) are collected
    into ``skipped`` rather than aborting the batch. This matches the UI
    pattern where the admin selects a handful of users and wants a clear
    "these succeeded, these didn't and why" read-back.
    """
    # De-dup and cap payload size has already been enforced by pydantic.
    ids = list(dict.fromkeys(body.user_ids))
    rows = session.exec(select(User).where(User.id.in_(ids))).all()  # type: ignore[attr-defined]
    found = {u.id: u for u in rows}

    skipped: list[dict] = []
    affected = 0

    def skip(uid: int, reason: str) -> None:
        skipped.append({"user_id": uid, "reason": reason})

    for uid in ids:
        user = found.get(uid)
        if not user:
            skip(uid, "not_found")
            continue
        if user.id == admin.id:
            skip(uid, "self")
            continue

        if body.action == "disable":
            if not user.is_active:
                skip(uid, "already_disabled")
                continue
            if user.role == UserRole.ADMIN and (
                _count_active_admins(session, exclude_user_id=user.id) == 0
            ):
                skip(uid, "last_admin")
                continue
            user.is_active = False
            session.add(user)
            session.add(AuditLog(
                action=AuditAction.USER_DISABLED,
                actor_user_id=admin.id,
                payload=f"user_id={uid}",
            ))
            affected += 1

        elif body.action == "enable":
            if user.is_active:
                skip(uid, "already_enabled")
                continue
            user.is_active = True
            session.add(user)
            session.add(AuditLog(
                action=AuditAction.USER_ENABLED,
                actor_user_id=admin.id,
                payload=f"user_id={uid}",
            ))
            affected += 1

        elif body.action == "delete":
            if user.role == UserRole.ADMIN and user.is_active and (
                _count_active_admins(session, exclude_user_id=user.id) == 0
            ):
                skip(uid, "last_admin")
                continue
            _hard_delete_user(session, user=user, actor_user_id=admin.id)  # type: ignore[arg-type]
            affected += 1

    session.commit()
    return BulkUsersResult(action=body.action, affected=affected, skipped=skipped)
