"""Address book — per-user opaque JSON blob.

The RustDesk native client (and the legacy kingmo888 panel) store the
whole address book as a single stringified JSON blob per user, wrapped
in an envelope:

    POST /api/ab/get   →  {"updated_at": "...", "data": "<stringified JSON>"}
    POST /api/ab       ←  {"data": "<stringified JSON>"}

The inner JSON contains:
    {
      "tags": [...],
      "peers": [{"id","username","hostname","alias","platform","tags":[],"hash"}],
      "tag_colors": "<stringified JSON dict>"
    }

We don't normalise peers/tags into their own tables here for two reasons:
1. Full-replace semantics — every PUT is an overwrite, so normalisation
   buys us nothing except write amplification and migration risk.
2. Shape drift — RustDesk has added fields (hash, tag_colors, forced_alias…)
   across versions. Opaque blob survives future clients we haven't seen.

One row per user. `user_id` is the primary key (not a FK — no join needed,
and we want the INSERT-OR-REPLACE semantics of "your AB is your row").
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class AddressBook(SQLModel, table=True):
    __tablename__ = "address_books"

    # One AB per user. Not a cascade FK on purpose — we prefer the
    # AB to linger if a user is soft-disabled; it's cheap and recovery-friendly.
    user_id: int = Field(foreign_key="users.id", primary_key=True)
    # Raw inner JSON, stored verbatim. We never parse/re-serialise — whatever
    # the client posted is what we give back, byte-for-byte. This preserves
    # key order, trailing whitespace, and forward-compat fields we don't
    # know about yet.
    data: str = Field(default="{}")
    updated_at: datetime = Field(default_factory=datetime.utcnow)
