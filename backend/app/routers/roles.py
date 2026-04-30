"""Roles & permissions — Settings → Roles & permisos panel."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import db as _db_module
from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.role import Role
from ..models.user import User, UserRole
from ..security import utcnow_naive

router = APIRouter(prefix="/admin/api/roles", tags=["admin:roles"])


# ─── Permission catalogue ──────────────────────────────────────────────────

# Permissions are flat strings grouped by feature for the UI. Adding a
# new permission is just adding a row here — no schema change.
PERMISSION_CATALOG: list[dict] = [
    {"group": "Dispositivos", "items": [
        {"id": "devices.read",     "label": "Ver dispositivos"},
        {"id": "devices.edit",     "label": "Editar metadata"},
        {"id": "devices.delete",   "label": "Eliminar dispositivos"},
        {"id": "devices.kick",     "label": "Forzar desconexión"},
    ]},
    {"group": "Usuarios", "items": [
        {"id": "users.read",       "label": "Ver operadores"},
        {"id": "users.invite",     "label": "Invitar nuevos"},
        {"id": "users.edit",       "label": "Editar permisos"},
        {"id": "users.delete",     "label": "Eliminar"},
    ]},
    {"group": "Tokens", "items": [
        {"id": "tokens.read",      "label": "Ver tokens"},
        {"id": "tokens.create",    "label": "Crear tokens"},
        {"id": "tokens.revoke",    "label": "Revocar tokens"},
    ]},
    {"group": "Auditoría", "items": [
        {"id": "logs.read",        "label": "Ver registro"},
        {"id": "logs.export",      "label": "Exportar"},
    ]},
    {"group": "Configuración", "items": [
        {"id": "settings.read",    "label": "Ver ajustes"},
        {"id": "settings.write",   "label": "Modificar ajustes del relay"},
        {"id": "roles.manage",     "label": "Gestionar roles"},
    ]},
]


_ALL_PERMISSION_IDS: set[str] = {
    item["id"] for group in PERMISSION_CATALOG for item in group["items"]
}


# Builtin roles bootstrapped on first startup. The two ids match the
# values of UserRole so existing users keep their assignment.
BUILTIN_ROLES: list[dict] = [
    {
        "id": "admin",
        "name": "Administrador",
        "description": "Acceso total al relay, usuarios y configuración.",
        "permissions": sorted(_ALL_PERMISSION_IDS),
    },
    {
        "id": "user",
        "name": "Usuario",
        "description": "Acceso de solo lectura — útil para auditoría externa o NOC.",
        "permissions": [
            "devices.read",
            "users.read",
            "tokens.read",
            "logs.read",
            "settings.read",
        ],
    },
]


# ─── Schemas ────────────────────────────────────────────────────────────────


class RoleOut(BaseModel):
    id: str
    name: str
    description: str
    permissions: list[str]
    builtin: bool
    member_count: int


class RoleCreate(BaseModel):
    id: str = Field(min_length=1, max_length=32, pattern=r"^[a-z][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=512)
    permissions: list[str] = Field(default_factory=list, max_length=128)


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=512)
    permissions: list[str] | None = Field(default=None, max_length=128)


class PermissionGroup(BaseModel):
    group: str
    items: list[dict]


class CatalogResponse(BaseModel):
    groups: list[PermissionGroup]


# ─── Helpers ────────────────────────────────────────────────────────────────


def _decode_perms(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(p) for p in parsed if isinstance(p, str)]
    except (ValueError, TypeError):
        pass
    return []


def _validate_perms(perms: list[str]) -> list[str]:
    """Drop unknown permission ids (silent — keeps the contract narrow
    while letting future feature flags coexist with older clients)."""
    return [p for p in perms if p in _ALL_PERMISSION_IDS]


def _count_members(session: Session, role_id: str) -> int:
    """How many users currently have this role assigned."""
    return len(
        session.exec(select(User).where(User.role == role_id)).all()  # type: ignore[arg-type]
    )


def _to_out(session: Session, r: Role) -> RoleOut:
    return RoleOut(
        id=r.id,
        name=r.name,
        description=r.description,
        permissions=_decode_perms(r.permissions),
        builtin=r.builtin,
        member_count=_count_members(session, r.id),
    )


def bootstrap_roles() -> None:
    """Insert the builtin roles if they don't exist yet. Called from
    app startup so a fresh DB renders the Roles panel immediately."""
    with Session(_db_module.engine) as session:
        existing = {r.id for r in session.exec(select(Role)).all()}
        for spec in BUILTIN_ROLES:
            if spec["id"] in existing:
                continue
            session.add(
                Role(
                    id=spec["id"],
                    name=spec["name"],
                    description=spec["description"],
                    permissions=json.dumps(spec["permissions"]),
                    builtin=True,
                )
            )
        session.commit()


# ─── Routes ─────────────────────────────────────────────────────────────────


@router.get("/catalog", response_model=CatalogResponse)
def get_catalog(_: AdminUser) -> CatalogResponse:
    """Return the static permission catalogue rendered by the panel's
    permission grid."""
    return CatalogResponse(
        groups=[PermissionGroup(group=g["group"], items=g["items"]) for g in PERMISSION_CATALOG]
    )


@router.get("", response_model=list[RoleOut])
def list_roles(session: SessionDep, _: AdminUser) -> list[RoleOut]:
    rows = session.exec(select(Role).order_by(Role.builtin.desc(), Role.created_at.asc())).all()  # type: ignore[attr-defined]
    return [_to_out(session, r) for r in rows]


@router.post("", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(
    body: RoleCreate, session: SessionDep, admin: AdminUser
) -> RoleOut:
    if session.get(Role, body.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Role with this id already exists")
    role = Role(
        id=body.id,
        name=body.name,
        description=body.description,
        permissions=json.dumps(_validate_perms(body.permissions)),
        builtin=False,
    )
    session.add(role)
    session.add(
        AuditLog(
            action=AuditAction.SETTINGS_CHANGED,
            actor_user_id=admin.id,
            payload=f"role.created id={role.id} name={role.name}",
        )
    )
    session.commit()
    session.refresh(role)
    return _to_out(session, role)


@router.patch("/{role_id}", response_model=RoleOut)
def update_role(
    role_id: str, body: RolePatch, session: SessionDep, admin: AdminUser
) -> RoleOut:
    role = session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")

    data = body.model_dump(exclude_unset=True)
    changed: list[str] = []

    # Builtin roles can have their description / permissions changed
    # (operators tighten what "user" can do, etc.) but their `name` is
    # locked — too many UI strings depend on the user-facing label.
    if role.builtin and "name" in data and data["name"] != role.name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot rename a built-in role",
        )

    if "name" in data and data["name"] != role.name:
        role.name = data["name"]
        changed.append("name")
    if "description" in data and data["description"] != role.description:
        role.description = data["description"]
        changed.append("description")
    if "permissions" in data:
        new_perms = json.dumps(_validate_perms(data["permissions"]))
        if new_perms != role.permissions:
            role.permissions = new_perms
            changed.append("permissions")

    if changed:
        role.updated_at = utcnow_naive()
        session.add(role)
        session.add(
            AuditLog(
                action=AuditAction.SETTINGS_CHANGED,
                actor_user_id=admin.id,
                payload=f"role.updated id={role.id} fields={','.join(changed)}",
            )
        )
    session.commit()
    session.refresh(role)
    return _to_out(session, role)


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: str, session: SessionDep, admin: AdminUser) -> None:
    role = session.get(Role, role_id)
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role not found")
    if role.builtin:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot delete a built-in role",
        )
    # Reassign every member to the "user" fallback so deleting a role
    # never leaves orphaned User.role references.
    members = session.exec(select(User).where(User.role == role_id)).all()  # type: ignore[arg-type]
    for u in members:
        u.role = UserRole.USER
        session.add(u)
    session.delete(role)
    session.add(
        AuditLog(
            action=AuditAction.SETTINGS_CHANGED,
            actor_user_id=admin.id,
            payload=f"role.deleted id={role_id} reassigned={len(members)} to=user",
        )
    )
    session.commit()
