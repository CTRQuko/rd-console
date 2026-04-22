"""Admin: server info + panel configuration. Read-only for now."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from .. import __version__
from ..config import get_settings
from ..deps import AdminUser

router = APIRouter(prefix="/admin/api/settings", tags=["admin:settings"])


class ServerInfo(BaseModel):
    server_host: str
    panel_url: str
    hbbs_public_key: str
    version: str


@router.get("/server-info", response_model=ServerInfo)
def server_info(_: AdminUser) -> ServerInfo:
    s = get_settings()
    return ServerInfo(
        server_host=s.server_host,
        panel_url=s.panel_url,
        hbbs_public_key=s.hbbs_public_key,
        version=__version__,
    )
