"""Reusable FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from .config import get_settings
from .db import get_session
from .models.user import User, UserRole
from .security import decode_access_token

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

SessionDep = Annotated[Session, Depends(get_session)]


def get_current_user(
    session: SessionDep,
    token: Annotated[str | None, Depends(_oauth2_scheme)],
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
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
