"""Roles & permissions catalogue.

The current `User.role` is a 2-value enum (admin/user) — this table
adds metadata (description, permission set) on top so the Settings →
Roles panel can render meaningful pages without forcing an enum
migration.

Built-in roles are seeded at startup (`bootstrap_roles`) and cannot
be deleted; their `permissions` field is editable so an operator
can tighten or relax what each tier can do at runtime. Custom roles
(builtin=False) can be created freely; if a custom role is later
deleted, any user holding it is downgraded to the "user" role on
the way out.

Permission ids are free-form strings so adding a new feature flag
doesn't require a schema change. The Settings panel renders a
fixed catalogue (`PERMISSION_CATALOG` in routers/roles.py).
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from ..security import utcnow_naive


class Role(SQLModel, table=True):
    __tablename__ = "roles"

    # String primary key so "admin" / "user" / custom-snake-case map
    # cleanly to User.role values.
    id: str = Field(primary_key=True, max_length=32)
    name: str = Field(max_length=64)
    description: str = Field(default="", max_length=512)
    # JSON-encoded list of permission strings. Stored as text so the
    # set of permissions can grow without a migration.
    permissions: str = Field(default="[]")
    builtin: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow_naive)
    updated_at: datetime = Field(default_factory=utcnow_naive)
