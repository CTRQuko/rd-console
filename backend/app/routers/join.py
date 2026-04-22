"""Public `/api/join/:token` — returns RustDesk client config for onboarding.

No auth required. Tokens are strictly single-use and opaque.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from ..config import get_settings
from ..deps import SessionDep
from ..models.join_token import JoinToken
from ..security import utcnow_naive

router = APIRouter(prefix="/api/join", tags=["public:join"])


class JoinConfig(BaseModel):
    id_server: str
    relay_server: str
    api_server: str
    public_key: str
    label: str | None


@router.get("/{token}", response_model=JoinConfig)
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

    s = get_settings()
    return JoinConfig(
        id_server=s.server_host,
        relay_server=s.server_host,
        api_server=s.panel_url,
        public_key=s.hbbs_public_key,
        label=row.label,
    )
