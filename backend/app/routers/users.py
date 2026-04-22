"""Admin: CRUD over panel users."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.user import User, UserRole
from ..security import hash_password

router = APIRouter(prefix="/admin/api/users", tags=["admin:users"])


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    email: EmailStr | None = None
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.USER


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


@router.get("", response_model=list[UserOut])
def list_users(session: SessionDep, _: AdminUser) -> list[UserOut]:
    rows = session.exec(select(User).order_by(User.created_at.desc())).all()
    return [UserOut.model_validate(r, from_attributes=True) for r in rows]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, session: SessionDep, admin: AdminUser) -> UserOut:
    if session.exec(select(User).where(User.username == body.username)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists")
    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    session.add(AuditLog(action=AuditAction.USER_CREATED, actor_user_id=admin.id,
                         payload=f"username={body.username}"))
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, session: SessionDep, admin: AdminUser) -> UserOut:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    data = body.model_dump(exclude_unset=True)
    if "password" in data and data["password"]:
        user.password_hash = hash_password(data.pop("password"))
    for k, v in data.items():
        setattr(user, k, v)

    session.add(user)
    session.add(AuditLog(action=AuditAction.USER_UPDATED, actor_user_id=admin.id,
                         payload=f"user_id={user_id}"))
    session.commit()
    session.refresh(user)
    return UserOut.model_validate(user, from_attributes=True)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def disable_user(user_id: int, session: SessionDep, admin: AdminUser) -> None:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot disable yourself")
    user.is_active = False
    session.add(user)
    session.add(AuditLog(action=AuditAction.USER_DISABLED, actor_user_id=admin.id,
                         payload=f"user_id={user_id}"))
    session.commit()
