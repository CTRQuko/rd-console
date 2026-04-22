"""Panel authentication — login, logout, whoami, change password."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select

from ..deps import CurrentUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.user import User
from ..security import create_access_token, hash_password, needs_rehash, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - not a password, OAuth2 scheme label


class MeResponse(BaseModel):
    id: int
    username: str
    email: str | None
    role: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, session: SessionDep) -> LoginResponse:
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        session.add(
            AuditLog(action=AuditAction.LOGIN_FAILED, payload=f"username={body.username}")
        )
        session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    user.last_login_at = datetime.utcnow()
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
    if len(body.new_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 8 chars")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()
