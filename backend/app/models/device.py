"""RustDesk devices registered against the panel."""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Device(SQLModel, table=True):
    __tablename__ = "devices"

    id: int | None = Field(default=None, primary_key=True)
    rustdesk_id: str = Field(index=True, unique=True, max_length=32)
    hostname: str | None = Field(default=None, max_length=128)
    username: str | None = Field(default=None, max_length=64)  # OS username
    platform: str | None = Field(default=None, max_length=32)  # windows/linux/macos/android
    cpu: str | None = Field(default=None, max_length=128)
    version: str | None = Field(default=None, max_length=32)
    owner_user_id: int | None = Field(default=None, foreign_key="users.id", index=True)
    last_ip: str | None = Field(default=None, max_length=45)  # v6-sized
    last_seen_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # v3: admin-authored per-device metadata. `note` is free-form (max 500
    # chars) and `is_favorite` is a panel-wide pin so admins can surface the
    # devices they touch daily. Both default to "no value" so existing rows
    # after SQLModel.metadata.create_all() on a v2 DB stay valid — SQLite
    # fills NULL / 0 for the new columns.
    note: str | None = Field(default=None, max_length=500)
    is_favorite: bool = Field(default=False, index=True)
