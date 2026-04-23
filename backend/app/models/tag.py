"""Admin-authored tags + the device<->tag link table.

A Tag is a short label (e.g. "office", "lab", "juan") that admins can
attach to devices for filtering. Names are case-insensitive unique — we
enforce this in the tags router at write time rather than via a SQLite
functional index (SQLite supports it but SQLModel's declarative doesn't
expose it cleanly, and the router layer is where we want the 409 surface
anyway).

A DeviceTag row joins one device to one tag. Both FK columns are part of
a composite primary key so `(device_id, tag_id)` is unique — re-assigning
the same tag is a 204 no-op rather than a duplicate.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Tag(SQLModel, table=True):
    __tablename__ = "tags"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=32, index=True)
    # One of a small fixed palette — the frontend maps these to CSS classes.
    # Kept as a plain string so adding a colour doesn't need a migration.
    color: str = Field(default="blue", max_length=16)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Auto-tags are synthesised by services/auto_tags.py from device
    # attributes (platform, version, owner). They cannot be edited or
    # deleted through the admin tags router — any attempt is rejected
    # with 400. When the underlying attribute changes, the auto-tag
    # re-attaches to the new tag (creating it if missing).
    auto: bool = Field(default=False)
    # Free-form provenance string, e.g. "platform", "version:major",
    # "owner". Primarily for the UI tooltip — not parsed by the backend.
    auto_source: str | None = Field(default=None, max_length=64)


class DeviceTag(SQLModel, table=True):
    __tablename__ = "device_tags"

    device_id: int = Field(foreign_key="devices.id", primary_key=True)
    tag_id: int = Field(foreign_key="tags.id", primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# Fixed palette the frontend knows how to style. Kept next to the model so
# the router can validate incoming `color` fields against the same list.
TAG_COLORS: tuple[str, ...] = (
    "blue",
    "green",
    "amber",
    "red",
    "violet",
    "zinc",
)
