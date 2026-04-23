"""Audit events — panel actions + RustDesk client protocol events.

v2 note: new DEVICE_* values added for the device admin actions (update /
forget / disconnect-requested). The values are plain strings so existing
rows in the database remain valid — we never rename an enum member once
it has been persisted.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel


class AuditAction(str, Enum):
    # Client-protocol events (fed by /api/audit from RustDesk clients)
    CONNECT = "connect"
    DISCONNECT = "disconnect"
    FILE_TRANSFER = "file_transfer"
    CLOSE = "close"
    # Panel events
    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DISABLED = "user_disabled"
    USER_ENABLED = "user_enabled"
    USER_DELETED = "user_deleted"
    SETTINGS_CHANGED = "settings_changed"
    SETTINGS_EXPORTED = "settings_exported"
    LOGS_DELETED = "logs_deleted"
    # v2: panel-initiated device actions
    DEVICE_UPDATED = "device_updated"
    DEVICE_FORGOTTEN = "device_forgotten"
    DEVICE_DISCONNECT_REQUESTED = "device_disconnect_requested"
    # v3: tagging + bulk device ops
    TAG_CREATED = "tag_created"
    TAG_DELETED = "tag_deleted"
    DEVICE_TAGGED = "device_tagged"
    DEVICE_UNTAGGED = "device_untagged"
    DEVICE_BULK_UPDATED = "device_bulk_updated"
    # v4: personal access tokens
    API_TOKEN_CREATED = "api_token_created"
    API_TOKEN_REVOKED = "api_token_revoked"
    # v4: address book (per-user blob)
    ADDRESS_BOOK_UPDATED = "address_book_updated"
    ADDRESS_BOOK_CLEARED = "address_book_cleared"
    # v4: join-token lifecycle (admin-minted invites for /api/join/:token)
    JOIN_TOKEN_CREATED = "join_token_created"
    JOIN_TOKEN_REVOKED = "join_token_revoked"
    JOIN_TOKEN_DELETED = "join_token_deleted"


# Category grouping used by /admin/api/logs?category=...
#
# Keeping this map next to the enum (rather than in the router) means any new
# action must consciously choose a category — the keys are the ground truth.
AUDIT_CATEGORIES: dict[str, tuple[AuditAction, ...]] = {
    "session": (
        AuditAction.CONNECT,
        AuditAction.DISCONNECT,
        AuditAction.FILE_TRANSFER,
        AuditAction.CLOSE,
    ),
    "auth": (
        AuditAction.LOGIN,
        AuditAction.LOGIN_FAILED,
        AuditAction.API_TOKEN_CREATED,
        AuditAction.API_TOKEN_REVOKED,
        AuditAction.JOIN_TOKEN_CREATED,
        AuditAction.JOIN_TOKEN_REVOKED,
        AuditAction.JOIN_TOKEN_DELETED,
    ),
    "user_management": (
        AuditAction.USER_CREATED,
        AuditAction.USER_UPDATED,
        AuditAction.USER_DISABLED,
        AuditAction.USER_ENABLED,
        AuditAction.USER_DELETED,
    ),
    "config": (
        AuditAction.SETTINGS_CHANGED,
        AuditAction.SETTINGS_EXPORTED,
        AuditAction.LOGS_DELETED,
        AuditAction.DEVICE_UPDATED,
        AuditAction.DEVICE_FORGOTTEN,
        AuditAction.DEVICE_DISCONNECT_REQUESTED,
        AuditAction.DEVICE_BULK_UPDATED,
        AuditAction.TAG_CREATED,
        AuditAction.TAG_DELETED,
        AuditAction.DEVICE_TAGGED,
        AuditAction.DEVICE_UNTAGGED,
    ),
    "address_book": (
        AuditAction.ADDRESS_BOOK_UPDATED,
        AuditAction.ADDRESS_BOOK_CLEARED,
    ),
}


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: int | None = Field(default=None, primary_key=True)
    action: AuditAction = Field(index=True)
    from_id: str | None = Field(default=None, max_length=32, index=True)  # RustDesk ID
    to_id: str | None = Field(default=None, max_length=32, index=True)
    ip: str | None = Field(default=None, max_length=45)
    uuid: str | None = Field(default=None, max_length=64)
    actor_user_id: int | None = Field(default=None, foreign_key="users.id")
    payload: str | None = Field(default=None)  # free-form JSON blob
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    # Soft-delete timestamp. Queries default to `WHERE deleted_at IS NULL`
    # so purged rows stop appearing in the UI; a separate cron (future
    # work) will hard-delete after N days. Kept here so a recently-purged
    # admin-misclick can be reverted by a direct UPDATE. The LOGS_DELETED
    # audit row that represents the purge is itself never soft-deleted —
    # enforced at the router.
    deleted_at: datetime | None = Field(default=None, index=True)
