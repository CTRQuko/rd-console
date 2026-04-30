"""Admin: check for newer releases of rd-console on GitHub."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..deps import AdminUser
from ..services.updates import get_status

router = APIRouter(prefix="/admin/api/updates", tags=["admin:updates"])


class UpdateStatusOut(BaseModel):
    current_version: str
    latest_version: str | None
    update_available: bool
    latest_url: str | None
    latest_published_at: str | None
    last_checked_at: str
    error: str | None = None


@router.get(
    "/status",
    response_model=UpdateStatusOut,
    summary="Compare the running version with the latest GitHub release",
)
def update_status(
    _: AdminUser,
    force: bool = Query(
        default=False,
        description="Ignore the 1-hour cache and re-fetch from GitHub now.",
    ),
) -> UpdateStatusOut:
    """Returns the running version + the latest tag published on GitHub.

    The cache is shared by every admin tab so concurrent opens don't
    stampede the GitHub API. `force=true` bypasses the cache (used by
    the "Comprobar actualizaciones" button).
    """
    s = get_status(force=force)
    return UpdateStatusOut(
        current_version=s.current_version,
        latest_version=s.latest_version,
        update_available=s.update_available,
        latest_url=s.latest_url,
        latest_published_at=s.latest_published_at,
        last_checked_at=s.last_checked_at,
        error=s.error,
    )
