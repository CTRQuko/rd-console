"""One-shot invite tokens for the public `/join/:token` onboarding page."""

from __future__ import annotations

import secrets
from datetime import datetime

from sqlmodel import Field, SQLModel


def _gen_token() -> str:
    # 32 bytes urlsafe → ~43 chars. Opaque, no PII.
    return secrets.token_urlsafe(32)


class JoinToken(SQLModel, table=True):
    __tablename__ = "join_tokens"

    id: int | None = Field(default=None, primary_key=True)
    token: str = Field(default_factory=_gen_token, index=True, unique=True, max_length=64)
    label: str | None = Field(default=None, max_length=128)  # e.g. "Abuela — laptop"
    created_by_user_id: int | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    used_at: datetime | None = None
    revoked: bool = Field(default=False)
