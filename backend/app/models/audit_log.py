"""Audit events — panel actions + RustDesk client protocol events."""

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
    SETTINGS_CHANGED = "settings_changed"


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
