"""Personal Access Token management.

Scope: per-user. A user can only see, mint, and revoke their OWN tokens.
Admins don't get a back door here on purpose — if an admin needs to revoke
another user's token, the right tool is ``PATCH /admin/api/users/{id}``
with ``is_active: false``, which invalidates every credential tied to that
account (JWT + PATs) in one go.

Why it lives next to /api/auth and not under /admin: PATs are an account-
level feature like "change password", not an administrative one.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import select

from ..deps import CurrentUser, SessionDep
from ..models.api_token import ApiToken
from ..models.audit_log import AuditAction, AuditLog
from ..security import (
    api_token_display_prefix,
    generate_api_token,
    hash_api_token,
    utcnow_naive,
)

router = APIRouter(prefix="/api/auth/tokens", tags=["auth:tokens"])


# ─── Schemas ────────────────────────────────────────────────────────────────


class TokenOut(BaseModel):
    """Token metadata — never includes the plaintext secret."""

    id: int
    name: str
    token_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None


class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    # Minutes from now. None = never expires. Capped at ~10 years to keep
    # rogue "forever" tokens vaguely within the realm of human oversight.
    expires_in_minutes: int | None = Field(default=None, ge=1, le=10 * 365 * 24 * 60)


class TokenCreateOut(BaseModel):
    """Returned ONCE on creation. The plaintext `token` field is never
    available again — lose it, mint a new one."""

    token: str
    metadata: TokenOut


# ─── Helpers ────────────────────────────────────────────────────────────────


def _to_out(t: ApiToken) -> TokenOut:
    return TokenOut(
        id=t.id,  # type: ignore[arg-type]
        name=t.name,
        token_prefix=t.token_prefix,
        created_at=t.created_at,
        last_used_at=t.last_used_at,
        expires_at=t.expires_at,
        revoked_at=t.revoked_at,
    )


# ─── Routes ─────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=TokenCreateOut,
    status_code=status.HTTP_201_CREATED,
)
def create_token(
    body: TokenCreate,
    user: CurrentUser,
    session: SessionDep,
) -> TokenCreateOut:
    plaintext = generate_api_token()
    now = utcnow_naive()
    expires_at: datetime | None = None
    if body.expires_in_minutes is not None:
        from datetime import timedelta

        expires_at = now + timedelta(minutes=body.expires_in_minutes)

    token = ApiToken(
        user_id=user.id,  # type: ignore[arg-type]
        name=body.name,
        token_hash=hash_api_token(plaintext),
        token_prefix=api_token_display_prefix(plaintext),
        created_at=now,
        expires_at=expires_at,
    )
    session.add(token)
    session.commit()
    session.refresh(token)

    session.add(
        AuditLog(
            action=AuditAction.API_TOKEN_CREATED,
            actor_user_id=user.id,
            payload=f"name={token.name} prefix={token.token_prefix} id={token.id}",
        )
    )
    session.commit()

    return TokenCreateOut(token=plaintext, metadata=_to_out(token))


@router.get("", response_model=list[TokenOut])
def list_tokens(user: CurrentUser, session: SessionDep) -> list[TokenOut]:
    rows = session.exec(
        select(ApiToken)
        .where(ApiToken.user_id == user.id)
        .order_by(ApiToken.created_at.desc())  # type: ignore[attr-defined]
    ).all()
    return [_to_out(t) for t in rows]


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(
    token_id: int,
    user: CurrentUser,
    session: SessionDep,
) -> None:
    token = session.get(ApiToken, token_id)
    # Same-shape 404 whether the row doesn't exist or belongs to someone else
    # — don't leak token_id enumeration across accounts.
    if not token or token.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    if token.revoked_at is not None:
        # Idempotent — second call still returns 204, nothing to do.
        return
    token.revoked_at = utcnow_naive()
    session.add(token)
    session.add(
        AuditLog(
            action=AuditAction.API_TOKEN_REVOKED,
            actor_user_id=user.id,
            payload=f"name={token.name} prefix={token.token_prefix} id={token.id}",
        )
    )
    session.commit()
