"""Personal Access Tokens (PAT) — long-lived bearer tokens scoped to a user.

Why these exist: JWT access tokens are short-lived (minutes) and tied to an
interactive login. Anything programmatic — a homelab cron that reconciles
device tags, a script that bulk-forgets stale peers, a Grafana dashboard
pulling audit logs — needs a credential that doesn't expire every 30 min
and can be revoked individually without nuking the owner's session.

Format on the wire: ``rdcp_<43 urlsafe-base64 chars>`` (token_urlsafe(32)).
The prefix makes them recognisable in logs/commits; the random tail has
256 bits of entropy, which is enough that we can store only a SHA-256
hash rather than burning argon2 CPU on every request.

We NEVER store the plaintext. The API returns it exactly once at creation
time; users that lose it must mint a new one and revoke the old.
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class ApiToken(SQLModel, table=True):
    __tablename__ = "api_tokens"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    # Human-friendly label ("laptop cron", "grafana-prod"). Not unique — a
    # user can legitimately have multiple tokens with the same name if they
    # rotate them.
    name: str = Field(max_length=64)
    # Hex SHA-256 of the plaintext token. Lookups go through this column so
    # it MUST be indexed; queries compute the hash server-side and filter.
    token_hash: str = Field(max_length=64, index=True, unique=True)
    # First 12 chars of the plaintext ("rdcp_<first 7 of tail>") so the UI
    # can show "rdcp_abcd1234…" without us being able to reconstruct the
    # token. Useful for identification in audit logs and revoke dialogs.
    token_prefix: str = Field(max_length=16, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Updated on every successful auth. Lets the UI surface abandoned tokens
    # for cleanup. We bump it at most once per request — no fancier
    # throttling because the write cost is trivial.
    last_used_at: datetime | None = None
    # Optional expiry. None = never expires (most common for homelab crons);
    # a value = hard cut-off checked on every auth.
    expires_at: datetime | None = None
    # Soft-delete. Once set, the token is rejected even if the hash matches.
    # We keep the row around so audit entries can still resolve the token
    # name + prefix after revocation.
    revoked_at: datetime | None = None
