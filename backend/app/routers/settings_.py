"""Admin: server info + panel configuration.

Three fields are operator-editable at runtime (``server_host``,
``panel_url``, ``hbbs_public_key``). PATCH writes overrides into the
``runtime_settings`` table; GET returns the merged view. Every consumer
of these values (``routers/join.py`` in particular) reads through the
same helper, so a PATCH takes effect immediately without a restart.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .. import __version__
from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.runtime_setting import RuntimeSetting
from ..security import utcnow_naive
from ..services.server_info import EDITABLE_KEYS, get_server_info

router = APIRouter(prefix="/admin/api/settings", tags=["admin:settings"])


class ServerInfoOut(BaseModel):
    server_host: str
    panel_url: str
    panel_name: str
    hbbs_public_key: str
    version: str


class ServerInfoPatch(BaseModel):
    """Partial update — only non-None fields are touched.

    An empty string is treated as "clear the override, fall back to env".
    Length caps protect the DB from obviously-wrong payloads (host/key
    should comfortably fit in 1KB each).
    """

    server_host: str | None = Field(default=None, max_length=1024)
    panel_url: str | None = Field(default=None, max_length=1024)
    panel_name: str | None = Field(default=None, max_length=128)
    hbbs_public_key: str | None = Field(default=None, max_length=4096)


def _set_override(session, *, key: str, value: str, user_id: int | None) -> None:
    """Upsert a runtime-setting row. Empty value → delete (clears override)."""
    existing = session.get(RuntimeSetting, key)
    if value == "":
        if existing is not None:
            session.delete(existing)
        return
    if existing is None:
        session.add(
            RuntimeSetting(
                key=key, value=value, updated_by_user_id=user_id,
                updated_at=utcnow_naive(),
            )
        )
    else:
        existing.value = value
        existing.updated_at = utcnow_naive()
        existing.updated_by_user_id = user_id
        session.add(existing)


@router.get("/server-info", response_model=ServerInfoOut)
def server_info(session: SessionDep, _: AdminUser) -> ServerInfoOut:
    info = get_server_info(session)
    return ServerInfoOut(
        server_host=info["server_host"],
        panel_url=info["panel_url"],
        panel_name=info["panel_name"],
        hbbs_public_key=info["hbbs_public_key"],
        version=__version__,
    )


@router.patch("/server-info", response_model=ServerInfoOut)
def update_server_info(
    body: ServerInfoPatch, session: SessionDep, admin: AdminUser,
) -> ServerInfoOut:
    changed: list[str] = []
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key not in EDITABLE_KEYS:
            # Defensive: the Pydantic schema is the source of truth, but if
            # a future field is added to the schema and not the allowlist,
            # this prevents silent writes.
            continue
        _set_override(session, key=key, value=value or "", user_id=admin.id)
        changed.append(key)

    if changed:
        session.add(AuditLog(
            action=AuditAction.SETTINGS_CHANGED,
            actor_user_id=admin.id,
            payload="keys=" + ",".join(sorted(changed)),
        ))
    session.commit()

    info = get_server_info(session)
    return ServerInfoOut(
        server_host=info["server_host"],
        panel_url=info["panel_url"],
        panel_name=info["panel_name"],
        hbbs_public_key=info["hbbs_public_key"],
        version=__version__,
    )


@router.get("/export", response_class=PlainTextResponse)
def export_settings(session: SessionDep, admin: AdminUser) -> str:
    """Export editable runtime settings as a ``.env``-style dump.

    Intentionally narrow: only the operator-editable keys (server_host,
    panel_url, hbbs_public_key) are emitted. Secrets (secret_key,
    admin_password, client_shared_secret) are NEVER included — dumping
    them defeats the point of having them env-only.

    The export itself is audited so operators can see who pulled it.
    """
    info = get_server_info(session)
    lines = [
        "# rd-console runtime settings — export",
        f"# generated at {utcnow_naive().isoformat()}Z",
        f"# by user_id={admin.id}",
        "#",
        "# NOTE: secrets (RD_SECRET_KEY, RD_ADMIN_PASSWORD, "
        "RD_CLIENT_SHARED_SECRET) are not included.",
        "",
        f"RD_SERVER_HOST={info['server_host']}",
        f"RD_PANEL_URL={info['panel_url']}",
        f"RD_PANEL_NAME={info['panel_name']}",
        f"RD_HBBS_PUBLIC_KEY={info['hbbs_public_key']}",
        "",
    ]
    body = "\n".join(lines)

    session.add(AuditLog(
        action=AuditAction.SETTINGS_EXPORTED,
        actor_user_id=admin.id,
        payload="keys=hbbs_public_key,panel_name,panel_url,server_host",
    ))
    session.commit()
    return body
