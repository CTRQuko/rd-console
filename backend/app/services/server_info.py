"""Read-time merge of env-derived settings with runtime overrides.

Centralised here so every consumer of the three operator-editable knobs
(``server_host``, ``panel_url``, ``hbbs_public_key``) picks up the same
merged view. The env value is the fallback; a row in ``runtime_settings``
with the matching key takes precedence.

If you add another editable key, add it to :data:`EDITABLE_KEYS` and to
the Pydantic schema in ``routers/settings_.py`` — the DB happily stores
anything, but the router deliberately rejects unknown keys so the
editable surface stays narrow.
"""

from __future__ import annotations

from typing import TypedDict

from sqlmodel import Session, select

from ..config import get_settings
from ..models.runtime_setting import RuntimeSetting

EDITABLE_KEYS: tuple[str, ...] = (
    "server_host",
    "panel_url",
    "panel_name",
    "hbbs_public_key",
)


class ServerInfo(TypedDict):
    server_host: str
    panel_url: str
    panel_name: str
    hbbs_public_key: str


def get_server_info(session: Session) -> ServerInfo:
    """Return the currently effective server info (DB override ∨ env)."""
    s = get_settings()
    defaults: ServerInfo = {
        "server_host": s.server_host,
        "panel_url": s.panel_url,
        "panel_name": s.panel_name,
        "hbbs_public_key": s.hbbs_public_key,
    }
    rows = session.exec(
        select(RuntimeSetting).where(RuntimeSetting.key.in_(EDITABLE_KEYS))  # type: ignore[attr-defined]
    ).all()
    out: ServerInfo = dict(defaults)  # type: ignore[assignment]
    for row in rows:
        # Unknown keys (left over from an older version) are ignored — the
        # contract is enforced at the router, not the table.
        if row.key in EDITABLE_KEYS:
            out[row.key] = row.value  # type: ignore[literal-required]
    return out
