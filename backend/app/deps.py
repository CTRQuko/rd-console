"""Reusable FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from .config import get_settings
from .db import get_session
from .models.api_token import ApiToken
from .models.user import User, UserRole
from .security import (
    decode_access_token,
    hash_api_token,
    looks_like_api_token,
    utcnow_naive,
)

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

SessionDep = Annotated[Session, Depends(get_session)]


def _resolve_api_token(session: Session, plaintext: str) -> User:
    """Validate a PAT and return its owner. Bumps last_used_at as a side
    effect so the UI can flag abandoned tokens.

    Raises 401 on any failure mode (unknown / revoked / expired / inactive
    owner) with a generic message — we never tell the caller *why* their
    token was rejected, same as the JWT path.
    """
    from sqlmodel import select

    token_hash = hash_api_token(plaintext)
    row = session.exec(select(ApiToken).where(ApiToken.token_hash == token_hash)).first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    now = utcnow_naive()
    if row.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if row.expires_at is not None and row.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    user = session.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")

    row.last_used_at = now
    session.add(row)
    session.commit()
    return user


def get_current_user(
    session: SessionDep,
    token: Annotated[str | None, Depends(_oauth2_scheme)],
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    # Route on the prefix: PATs are routed to the DB lookup path, everything
    # else is treated as a JWT. This means a malformed PAT can never be
    # mistaken for a JWT (and vice-versa) — the branches never cross.
    if looks_like_api_token(token):
        return _resolve_api_token(session, token)

    claims = decode_access_token(token)
    if not claims:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    try:
        user_id = int(claims["sub"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token") from None
    user = session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def require_client_secret(
    x_rd_secret: Annotated[str | None, Header(alias="X-RD-Secret")] = None,
) -> None:
    """Gate RustDesk client-protocol endpoints behind a shared secret.

    If `RD_CLIENT_SHARED_SECRET` is empty, endpoints remain open (backward
    compatible). When it is set, the header must match exactly.
    """
    s = get_settings()
    if not s.client_shared_secret:
        return
    if x_rd_secret != s.client_shared_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid client secret")


ClientSecretDep = Annotated[None, Depends(require_client_secret)]
