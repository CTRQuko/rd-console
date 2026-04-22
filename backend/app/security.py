"""Password hashing (argon2id) + JWT helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from jose import JWTError, jwt

from .config import get_settings

_hasher = PasswordHasher()


# ─── Time helpers (tz-aware internally, naive on the wire to match DB cols) ───

def utcnow_naive() -> datetime:
    """UTC now, naive. Matches SQLModel columns that store naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ─── Passwords ───

def hash_password(plain: str) -> str:
    """Hash a cleartext password with argon2id. Returns the encoded hash."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a cleartext password against a stored argon2 hash."""
    try:
        return _hasher.verify(hashed, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:  # noqa: BLE001 - defensive, argon2 can raise subclasses
        return False


def needs_rehash(hashed: str) -> bool:
    """True if the hash should be recomputed (parameters outdated)."""
    try:
        return _hasher.check_needs_rehash(hashed)
    except InvalidHashError:
        return True


# ─── JWT ───

def create_access_token(
    subject: str | int,
    extra_claims: dict[str, Any] | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT for a given subject (typically the user id)."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    exp_delta = expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
    }
    if extra_claims:
        # Never let extra_claims override the standard claims.
        for reserved in ("sub", "iat", "nbf", "exp"):
            extra_claims.pop(reserved, None)
        payload.update(extra_claims)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT. Returns claims dict or None if invalid/expired."""
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={
                "require": ["exp", "iat", "sub"],
                "verify_exp": True,
                "verify_iat": True,
                "verify_signature": True,
            },
        )
    except JWTError:
        return None
