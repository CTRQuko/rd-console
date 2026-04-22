"""Panel authentication — login, logout, whoami, change password."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import select

from ..deps import CurrentUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.user import User
from ..security import (
    create_access_token,
    hash_password,
    needs_rehash,
    utcnow_naive,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth2 scheme label


class MeResponse(BaseModel):
    id: int
    username: str
    email: str | None
    role: str


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, session: SessionDep) -> LoginResponse:
    user = session.exec(select(User).where(User.username == body.username)).first()
    # Constant-ish branch: always hit verify_password when user exists to reduce
    # user-enumeration timing skew.
    password_ok = bool(user) and verify_password(body.password, user.password_hash)  # type: ignore[union-attr]
    if not user or not user.is_active or not password_ok:
        session.add(
            AuditLog(
                action=AuditAction.LOGIN_FAILED,
                payload=f"username={body.username[:64]}",
            )
        )
        session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    user.last_login_at = utcnow_naive()
    session.add(user)
    session.add(AuditLog(action=AuditAction.LOGIN, actor_user_id=user.id))
    session.commit()
    session.refresh(user)

    token = create_access_token(subject=user.id, extra_claims={"role": user.role.value})
    return LoginResponse(access_token=token)


@router.get("/me", response_model=MeResponse)
def me(user: CurrentUser) -> MeResponse:
    return MeResponse(id=user.id, username=user.username, email=user.email, role=user.role.value)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePasswordRequest, user: CurrentUser, session: SessionDep) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must differ")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
