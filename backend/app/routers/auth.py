"""Panel authentication — login, logout, whoami, change password."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlmodel import select

from ..deps import CurrentUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.jwt_revocation import JwtRevocation
from ..models.jwt_session import JwtSession
from ..models.user import User
from ..security import (
    create_access_token,
    decode_access_token,
    hash_password,
    needs_rehash,
    utcnow_naive,
    verify_password,
)
from ..services.rate_limit import rate_limit_dep

# 10 attempts per IP per minute is deliberately lenient — legitimate typos
# and the occasional "I forgot which password" happen. A credential-stuffing
# attacker still only gets 10 tries per rollover, and the Retry-After header
# makes client-side backoff trivial. Tighten if we ever see abuse.
_login_limiter = rate_limit_dep(bucket="login", limit=10, window_seconds=60)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    # The Claude Design login form labels this field "Email", but admins can
    # still type a plain username. We accept either: if the value contains
    # "@" we treat it as an email lookup, otherwise as a username lookup.
    username: str = Field(min_length=1, max_length=128)
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


@router.post(
    "/login",
    response_model=LoginResponse,
    dependencies=[Depends(_login_limiter)],
    summary="Panel login — exchange username/password for a JWT",
)
def login(body: LoginRequest, session: SessionDep, request: Request) -> LoginResponse:
    """Authenticate a panel user and return a short-lived JWT.

    On invalid credentials this endpoint emits a `LOGIN_FAILED` audit entry
    and returns 401 with a constant-time branch to reduce user-enumeration
    timing leaks. The returned `access_token` must be sent in the
    `Authorization: Bearer …` header on every subsequent call to
    `/admin/api/**`.

    On success a JwtSession row is recorded so Settings → Sesiones
    activas can show every device the operator is logged in from.
    """
    # Dual lookup: email if the field contains "@", username otherwise.
    if "@" in body.username:
        user = session.exec(select(User).where(User.email == body.username)).first()
    else:
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

    # Record the session so the operator can later see + revoke it
    # from Settings → Sesiones activas. Pulls jti + exp directly from
    # the token we just minted so the row matches what the JWT will
    # carry on subsequent requests.
    claims = decode_access_token(token) or {}
    jti = claims.get("jti")
    exp = claims.get("exp")
    if jti and exp:
        try:
            ua = request.headers.get("user-agent", "")[:512] or None
            ip = request.client.host if request.client else None
            session.add(JwtSession(
                jti=jti,
                user_id=user.id,
                created_at=utcnow_naive(),
                expires_at=datetime.fromtimestamp(int(exp)),
                user_agent=ua,
                ip=ip,
            ))
            session.commit()
        except Exception:  # noqa: BLE001
            # Tracking is best-effort — never block login on a session
            # row insert.
            session.rollback()

    return LoginResponse(access_token=token)


@router.get(
    "/me",
    response_model=MeResponse,
    summary="Return the currently authenticated panel user",
)
def me(user: CurrentUser) -> MeResponse:
    """Identity endpoint — echoes the JWT subject as a `MeResponse`.

    Used by the frontend after login to populate the user menu and gate
    admin-only routes client-side. Does not extend the token TTL.
    """
    return MeResponse(id=user.id, username=user.username, email=user.email, role=user.role.value)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    user: CurrentUser,
    session: SessionDep,
    authorization: str | None = Header(default=None),
) -> None:
    """Revoke the exact JWT that made this call.

    The CurrentUser dep already validated the token end-to-end (signature,
    exp, revocation list) — by the time we're in here the token is
    legitimate and we know who's logging out. We decode again to extract
    the jti + exp; if anything's off (no header, malformed claims) we
    return 204 silently rather than leaking state.

    Granularity is per-token, not per-user: other sessions of the same
    user stay alive. That matches how iOS / Gmail / GitHub handle logout,
    and avoids surprise "logging out on my laptop killed my phone".
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_access_token(token)
    if not claims or "jti" not in claims or "exp" not in claims:
        return
    jti = claims["jti"]
    # Upsert — a second logout with the same token is a no-op. Uses
    # session.get because the PK is jti; no unique index race to worry
    # about since it's the PK.
    if session.get(JwtRevocation, jti) is not None:
        return
    session.add(
        JwtRevocation(
            jti=jti,
            user_id=user.id,
            expires_at=datetime.utcfromtimestamp(int(claims["exp"])),
        )
    )
    session.commit()


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the current user's password",
)
def change_password(body: ChangePasswordRequest, user: CurrentUser, session: SessionDep) -> None:
    """Rotate the password of the authenticated user.

    Requires the current password to confirm. Rejects no-op rotations
    (same password in and out). Does not revoke existing JWTs — the
    caller's token remains valid until natural expiry.
    """
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must differ")
    user.password_hash = hash_password(body.new_password)
    session.add(user)
    session.commit()


# ─── Sessions list / revoke (Settings → Seguridad → Sesiones activas) ───


class SessionOut(BaseModel):
    jti: str
    created_at: datetime
    expires_at: datetime
    user_agent: str | None = None
    ip: str | None = None
    is_current: bool = False


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    user: CurrentUser,
    session: SessionDep,
    authorization: str | None = Header(default=None),
) -> list[SessionOut]:
    """Return every non-revoked, non-expired JWT session for the caller.

    The session that's making this call is flagged with `is_current: true`
    so the UI can render it differently (typically: hide the revoke
    button, since revoking your own current session is the same as
    logging out and is handled by /logout).
    """
    current_jti: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        claims = decode_access_token(token)
        if claims:
            current_jti = claims.get("jti")

    now = utcnow_naive()
    rows = session.exec(
        select(JwtSession)
        .where(JwtSession.user_id == user.id)
        .where(JwtSession.revoked_at.is_(None))  # type: ignore[union-attr]
        .where(JwtSession.expires_at > now)
        .order_by(JwtSession.created_at.desc())  # type: ignore[attr-defined]
    ).all()

    return [
        SessionOut(
            jti=row.jti,
            created_at=row.created_at,
            expires_at=row.expires_at,
            user_agent=row.user_agent,
            ip=row.ip,
            is_current=(row.jti == current_jti),
        )
        for row in rows
    ]


@router.delete("/sessions/{jti}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    jti: str,
    user: CurrentUser,
    session: SessionDep,
) -> None:
    """Revoke one specific session by jti. Both the JwtSession row and
    the JwtRevocation row are written so subsequent decodes reject the
    token immediately.

    A user can only revoke their own sessions; passing someone else's
    jti returns 404 (avoids confirming the existence of unknown jtis).
    """
    row = session.get(JwtSession, jti)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if row.revoked_at is None:
        row.revoked_at = utcnow_naive()
        session.add(row)
    if session.get(JwtRevocation, jti) is None:
        session.add(JwtRevocation(jti=jti, user_id=user.id, expires_at=row.expires_at))
    session.commit()
