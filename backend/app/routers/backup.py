"""Admin: JSON backup and restore of panel state (users, tags, settings, token metadata).

Secrets are NEVER included in the export — no password_hash, token_hash, token,
RD_SECRET_KEY, RD_ADMIN_PASSWORD, or RD_CLIENT_SHARED_SECRET.

Restore modes:
  dry_run (default) — compute and return the diff, no writes.
  apply             — apply the diff idempotently (upsert by natural key).
                      Existing users retain their password_hash. New users are
                      created with a random password that forces a reset.
"""

from __future__ import annotations

import json
import secrets
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.api_token import ApiToken
from ..models.audit_log import AuditAction, AuditLog
from ..models.join_token import JoinToken
from ..models.runtime_setting import RuntimeSetting
from ..models.tag import Tag
from ..models.user import User, UserRole
from ..security import hash_password, utcnow_naive

router = APIRouter(prefix="/admin/api/backup", tags=["admin:backup"])

# Settings keys included in the export (safe, non-secret values).
_EXPORTED_SETTING_KEYS = {"server_host", "panel_url", "hbbs_public_key"}


# ─── Pydantic schemas ────────────────────────────────────────────────────────

class BackupUser(BaseModel):
    username: str
    email: str | None
    role: Literal["admin", "user"]
    is_active: bool
    created_at: datetime


class BackupTag(BaseModel):
    name: str
    color: str


class BackupSetting(BaseModel):
    key: str
    value: str


class BackupApiTokenMeta(BaseModel):
    name: str
    token_prefix: str
    created_at: datetime
    expires_at: datetime | None


class BackupJoinTokenMeta(BaseModel):
    token_prefix: str
    label: str | None
    created_at: datetime
    expires_at: datetime | None


class BackupBundle(BaseModel):
    schema_version: Literal[1] = 1
    exported_at: datetime
    users: list[BackupUser]
    tags: list[BackupTag]
    settings: list[BackupSetting]
    api_tokens: list[BackupApiTokenMeta]
    join_tokens: list[BackupJoinTokenMeta]


class RestoreDiff(BaseModel):
    users: dict[str, int]      # {"add": N, "update": N}
    tags: dict[str, int]
    settings: dict[str, int]
    api_tokens: dict[str, int]
    join_tokens: dict[str, int]


class RestoreResult(BaseModel):
    mode: Literal["dry_run", "apply"]
    diff: RestoreDiff


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _build_bundle(session) -> BackupBundle:
    users = session.exec(select(User)).all()
    tags = session.exec(select(Tag).where(Tag.auto == False)).all()  # noqa: E712
    settings = session.exec(
        select(RuntimeSetting).where(RuntimeSetting.key.in_(_EXPORTED_SETTING_KEYS))
    ).all()
    api_tokens = session.exec(select(ApiToken)).all()
    join_tokens = session.exec(select(JoinToken)).all()

    return BackupBundle(
        exported_at=utcnow_naive(),
        users=[
            BackupUser(
                username=u.username,
                email=u.email,
                role=u.role.value,
                is_active=u.is_active,
                created_at=u.created_at,
            )
            for u in users
        ],
        tags=[BackupTag(name=t.name, color=t.color) for t in tags],
        settings=[BackupSetting(key=s.key, value=s.value) for s in settings],
        api_tokens=[
            BackupApiTokenMeta(
                name=t.name,
                token_prefix=t.token_prefix,
                created_at=t.created_at,
                expires_at=t.expires_at,
            )
            for t in api_tokens
        ],
        join_tokens=[
            BackupJoinTokenMeta(
                token_prefix=jt.token_prefix,  # campo persistido tras VULN-04
                label=jt.label,
                created_at=jt.created_at,
                expires_at=jt.expires_at,
            )
            for jt in join_tokens
        ],
    )


def _compute_diff(bundle: BackupBundle, session) -> RestoreDiff:
    existing_users = {u.username for u in session.exec(select(User)).all()}
    existing_tags = {t.name.lower() for t in session.exec(select(Tag)).all()}
    existing_settings = {s.key for s in session.exec(select(RuntimeSetting)).all()}
    existing_token_prefixes = {t.token_prefix for t in session.exec(select(ApiToken)).all()}
    existing_jt_prefixes = {jt.token_prefix for jt in session.exec(select(JoinToken)).all()}

    u_add = sum(1 for u in bundle.users if u.username not in existing_users)
    u_update = sum(1 for u in bundle.users if u.username in existing_users)
    t_add = sum(1 for t in bundle.tags if t.name.lower() not in existing_tags)
    t_update = sum(1 for t in bundle.tags if t.name.lower() in existing_tags)
    s_add = sum(1 for s in bundle.settings if s.key not in existing_settings)
    s_update = sum(1 for s in bundle.settings if s.key in existing_settings)
    at_add = sum(1 for at in bundle.api_tokens if at.token_prefix not in existing_token_prefixes)
    jt_add = sum(1 for jt in bundle.join_tokens if jt.token_prefix not in existing_jt_prefixes)

    return RestoreDiff(
        users={"add": u_add, "update": u_update},
        tags={"add": t_add, "update": t_update},
        settings={"add": s_add, "update": s_update},
        api_tokens={"add": at_add, "skip": len(bundle.api_tokens) - at_add},
        join_tokens={"add": jt_add, "skip": len(bundle.join_tokens) - jt_add},
    )


def _apply_bundle(bundle: BackupBundle, session) -> RestoreDiff:
    diff = _compute_diff(bundle, session)

    existing_users = {u.username: u for u in session.exec(select(User)).all()}
    for bu in bundle.users:
        if bu.username in existing_users:
            u = existing_users[bu.username]
            u.email = bu.email
            u.role = UserRole(bu.role)
            u.is_active = bu.is_active
            session.add(u)
        else:
            u = User(
                username=bu.username,
                email=bu.email,
                role=UserRole(bu.role),
                is_active=bu.is_active,
                created_at=bu.created_at,
                password_hash=hash_password(secrets.token_urlsafe(24)),
            )
            session.add(u)

    existing_tags = {t.name.lower(): t for t in session.exec(select(Tag)).all()}
    for bt in bundle.tags:
        if bt.name.lower() not in existing_tags:
            session.add(Tag(name=bt.name, color=bt.color))
        else:
            tag = existing_tags[bt.name.lower()]
            tag.color = bt.color
            session.add(tag)

    existing_settings = {s.key: s for s in session.exec(select(RuntimeSetting)).all()}
    for bs in bundle.settings:
        if bs.key in _EXPORTED_SETTING_KEYS:
            if bs.key in existing_settings:
                existing_settings[bs.key].value = bs.value
                session.add(existing_settings[bs.key])
            else:
                session.add(RuntimeSetting(key=bs.key, value=bs.value))

    session.commit()
    return diff


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get(
    "",
    response_model=BackupBundle,
    summary="Export panel state as JSON",
)
def export_backup(session: SessionDep, admin: AdminUser) -> BackupBundle:
    """Export users, tags, runtime settings, and token metadata.

    Secrets (password_hash, token_hash, token, RD_SECRET_KEY,
    RD_ADMIN_PASSWORD, RD_CLIENT_SHARED_SECRET) are never included.
    """
    bundle = _build_bundle(session)
    session.add(AuditLog(
        action=AuditAction.BACKUP_EXPORTED,
        actor_user_id=admin.id,
        payload=json.dumps({
            "users": len(bundle.users),
            "tags": len(bundle.tags),
            "settings": len(bundle.settings),
        }),
    ))
    session.commit()
    return bundle


@router.post(
    "/restore",
    response_model=RestoreResult,
    summary="Restore panel state from a backup bundle",
)
def restore_backup(
    bundle: BackupBundle,
    session: SessionDep,
    admin: AdminUser,
    mode: Literal["dry_run", "apply"] = Query(default="dry_run"),
) -> RestoreResult:
    """Apply a backup bundle to the panel.

    ``?mode=dry_run`` (default) returns the diff without writing anything.
    ``?mode=apply`` applies changes idempotently — existing users keep their
    passwords; new users get a random password that must be reset.
    """
    if mode == "apply":
        diff = _apply_bundle(bundle, session)
        session.add(AuditLog(
            action=AuditAction.BACKUP_RESTORED,
            actor_user_id=admin.id,
            payload=json.dumps({
                "mode": "apply",
                "users_added": diff.users["add"],
                "users_updated": diff.users["update"],
                "tags_added": diff.tags["add"],
            }),
        ))
        session.commit()
    else:
        diff = _compute_diff(bundle, session)

    return RestoreResult(mode=mode, diff=diff)
