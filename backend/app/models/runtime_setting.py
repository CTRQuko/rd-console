"""Runtime-overridable settings — a narrow escape hatch from env-only config.

A handful of knobs (the RustDesk server host, the panel's public URL, the
hbbs public key) are legitimately operator-editable after initial setup:
the same image ships to multiple instances, each with a different DNS
name. Rather than force a container redeploy to change them, we persist
overrides in this table and merge them on top of the env-derived
``Settings`` at read-time.

Deliberately kept KEY/VALUE rather than one column per setting: every
addition to the editable surface would otherwise require a schema
migration. The key set is enforced at the router layer, not at the DB
layer — if a row for an unknown key exists, it is just ignored.

We only persist VALUES that genuinely differ from the env. Leaving a row
absent means "use the env default" — clearing an override is a delete,
not a set-to-empty-string.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class RuntimeSetting(SQLModel, table=True):
    __tablename__ = "runtime_settings"

    key: str = Field(primary_key=True, max_length=64)
    value: str = Field(max_length=4096)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    updated_by_user_id: int | None = Field(default=None, foreign_key="users.id")
