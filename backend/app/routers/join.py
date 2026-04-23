"""Public `/api/join/:token` — returns RustDesk client config for onboarding.

No auth required. Tokens are strictly single-use and opaque.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from ..deps import SessionDep
from ..models.join_token import JoinToken
from ..security import utcnow_naive
from ..services.rate_limit import rate_limit_dep
from ..services.server_info import get_server_info

# 30 / minute / IP. Higher than /login because legitimate users may click
# the invite URL a couple of times (new tab, ctrl+R, password manager
# preview) and shared-NAT households could hit /join from multiple peers
# close in time. Still low enough to discourage enumeration of tokens.
_join_limiter = rate_limit_dep(bucket="join", limit=30, window_seconds=60)

router = APIRouter(prefix="/api/join", tags=["public:join"])


class JoinConfig(BaseModel):
    id_server: str
    relay_server: str
    api_server: str
    public_key: str
    label: str | None


@router.get(
    "/{token}",
    response_model=JoinConfig,
    dependencies=[Depends(_join_limiter)],
)
def get_join_config(token: str, session: SessionDep) -> JoinConfig:
    # Reject obviously malformed tokens early; secrets.token_urlsafe(32) is ~43 chars.
    if not token or len(token) > 64:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid or revoked token")

    row = session.exec(select(JoinToken).where(JoinToken.token == token)).first()
    if not row or row.revoked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid or revoked token")

    now = utcnow_naive()
    if row.expires_at and row.expires_at < now:
        raise HTTPException(status.HTTP_410_GONE, "Token expired")

    # Strict single-use: second fetch returns 410, not the config.
    if row.used_at is not None:
        raise HTTPException(status.HTTP_410_GONE, "Token already used")

    row.used_at = now
    session.add(row)
    session.commit()

    info = get_server_info(session)
    return JoinConfig(
        id_server=info["server_host"],
        relay_server=info["server_host"],
        api_server=info["panel_url"],
        public_key=info["hbbs_public_key"],
        label=row.label,
    )
