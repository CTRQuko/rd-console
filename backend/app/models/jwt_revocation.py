"""JWT revocation list — per-token deny-list keyed on the JWT `jti` claim.

Why this exists: before v8 our JWTs were fully stateless. `POST /api/logout`
returned `{code: 1}` but the token kept working until its natural exp. A
leaked token or a "sign me out of all my tabs" flow had no backend answer.

The approach mirrors the `ApiToken.revoked_at` pattern already in the
codebase, but keyed by `jti` rather than `token_hash`:

  * `create_access_token` adds a uuid4 `jti` claim to every JWT.
  * `get_current_user` rejects a token whose `jti` is in this table.
  * `POST /api/auth/logout` (panel) and `POST /api/logout` (Flutter alias)
    upsert a row on the caller's behalf.
  * A background coroutine purges rows whose `expires_at` is in the past —
    at that point the underlying JWT would be rejected for `exp` anyway, so
    the row adds no security value and just eats disk.

NOT used for PATs (Personal Access Tokens) — those already carry their own
`revoked_at` on `ApiToken`. The two auth paths stay separated.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from ..security import utcnow_naive


class JwtRevocation(SQLModel, table=True):
    __tablename__ = "jwt_revocations"

    # uuid4 str — 36 chars including dashes. PK because a jti can only be
    # revoked once; a second logout attempt is a no-op on upsert.
    jti: str = Field(primary_key=True, max_length=36)
    # Indexed for cleanup-by-user ("revoke all my tokens" in a future
    # sprint) and for audit cross-references.
    user_id: int = Field(foreign_key="users.id", index=True)
    revoked_at: datetime = Field(default_factory=utcnow_naive)
    # Mirrors the JWT's exp claim — when the token is already naturally
    # expired, the row contributes nothing. The cleanup loop drops rows
    # where expires_at <= now().
    expires_at: datetime
