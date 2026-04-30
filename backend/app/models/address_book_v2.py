"""Address-book v2 — typed Group + Contact tables.

The original /api/ab/{get,put} endpoints stored a single opaque JSON
blob per user (the kingmo888 panel format). That worked for read-only
display, but every editor operation (rename group, add contact,
re-tag) had to round-trip the entire blob with all the race-condition
risk of last-writer-wins.

v2 splits the blob into normalised rows so the editor can issue
targeted CRUD calls. The legacy /api/ab endpoints stay around
verbatim — RustDesk clients still call them and we don't want to
break sync. The new /api/ab/v2 namespace coexists.

If a user opens the v2 editor without ever having migrated their
v1 blob, the first call to GET /api/ab/v2/groups auto-imports the
blob into Group + Contact rows (idempotent — skipped if any v2 row
already exists for that user).
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from ..security import utcnow_naive


class AbGroup(SQLModel, table=True):
    """A user-owned label for a bunch of contacts. Display colour
    matches the device tag palette so the AddressBook page can render
    pills with the same vocabulary."""

    __tablename__ = "ab_groups"

    id: int | None = Field(default=None, primary_key=True)
    owner_user_id: int = Field(foreign_key="users.id", index=True)
    name: str = Field(max_length=128)
    color: str = Field(default="blue", max_length=32)
    note: str = Field(default="", max_length=500)
    created_at: datetime = Field(default_factory=utcnow_naive)
    updated_at: datetime = Field(default_factory=utcnow_naive)


class AbContact(SQLModel, table=True):
    """One peer inside a group. Mirrors the fields the kingmo888 blob
    surfaces (`id`, `username`, `platform`, optional alias + note)
    plus a tag list stored as a JSON string."""

    __tablename__ = "ab_contacts"

    id: int | None = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="ab_groups.id", index=True)
    rd_id: str = Field(max_length=32, index=True)
    alias: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=128)
    platform: str = Field(default="", max_length=64)
    note: str = Field(default="", max_length=500)
    # JSON array of tag strings. Stored as text to dodge a many-to-many
    # join for what's a glorified label set.
    tags: str = Field(default="[]")
    created_at: datetime = Field(default_factory=utcnow_naive)
    updated_at: datetime = Field(default_factory=utcnow_naive)
