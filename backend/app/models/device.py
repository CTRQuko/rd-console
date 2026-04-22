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
