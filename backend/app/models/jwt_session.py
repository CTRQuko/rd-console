"""Tracking row per JWT issued (one per successful /login).

This complements JwtRevocation (which only stores revoked jtis):

  * `auth.py login` inserts a row per minted JWT, capturing the
    user-agent + IP at the time of login so the operator can later
    look at "Settings → Seguridad → Sesiones activas" and recognise
    each device.
  * `Settings → Sesiones activas` lists rows where revoked_at IS
    NULL AND expires_at > now() for the calling user.
  * Revoking a session here writes both into JwtSession.revoked_at
    *and* JwtRevocation, so subsequent decode_access_token rejects
    the token immediately.
  * Same cleanup task that purges JwtRevocation rows can purge
    JwtSession rows past their expires_at — they're informational
    once the JWT is dead.

Decision not to track per-request "last seen" timestamp: that would
require writing on every authenticated request, which kills the cost
profile of a stateless JWT. The list shows `created_at` instead and
the operator can revoke based on age + UA fingerprint.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from ..security import utcnow_naive


class JwtSession(SQLModel, table=True):
    __tablename__ = "jwt_sessions"

    # The JWT's jti claim — also the join key with JwtRevocation.
    jti: str = Field(primary_key=True, max_length=36)
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=utcnow_naive)
    expires_at: datetime
    user_agent: str | None = Field(default=None, max_length=512)
    ip: str | None = Field(default=None, max_length=45)
    revoked_at: datetime | None = Field(default=None, index=True)
