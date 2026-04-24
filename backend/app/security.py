"""Password hashing (argon2id) + JWT helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from jose import JWTError, jwt

from .config import get_settings

_hasher = PasswordHasher()


# ─── Time helpers (tz-aware internally, naive on the wire to match DB cols) ───

def utcnow_naive() -> datetime:
    """UTC now, naive. Matches SQLModel columns that store naive UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


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
    now = datetime.now(UTC)
    exp_delta = expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int((now + exp_delta).timestamp()),
        # Unique per-token identifier used by the revocation deny-list
        # (see app.models.jwt_revocation). uuid4 is 128 bits of entropy —
        # collisions are not a concern.
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        # Never let extra_claims override the standard claims.
        for reserved in ("sub", "iat", "nbf", "exp", "jti"):
            extra_claims.pop(reserved, None)
        payload.update(extra_claims)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


# ─── Personal Access Tokens ───
#
# PAT format on the wire: ``rdcp_<43 urlsafe-base64 chars>``.
# 43 chars of urlsafe-b64 == 32 random bytes == 256 bits of entropy, so we
# can skip argon2 and just SHA-256 the whole thing; birthday-bound a hash
# collision would need 2^128 tokens. The prefix is constant so it doesn't
# reduce entropy — it just makes tokens grep-able in logs and commits.

API_TOKEN_PREFIX = "rdcp_"  # noqa: S105 - not a password, a namespace marker
_API_TOKEN_RANDOM_BYTES = 32
# First 12 chars shown in the UI so users can tell their tokens apart
# without us storing plaintext. 12 chars = prefix (5) + 7 of tail.
_API_TOKEN_DISPLAY_LEN = 12


def generate_api_token() -> str:
    """Return a fresh plaintext PAT. Caller must store only the hash."""
    return f"{API_TOKEN_PREFIX}{secrets.token_urlsafe(_API_TOKEN_RANDOM_BYTES)}"


def hash_api_token(plain: str) -> str:
    """Hex SHA-256 of a PAT. Deterministic — same input, same output,
    which is exactly what we want for the DB lookup path."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def api_token_display_prefix(plain: str) -> str:
    """First 12 chars of the plaintext token — safe to persist for UI."""
    return plain[:_API_TOKEN_DISPLAY_LEN]


def looks_like_api_token(candidate: str) -> bool:
    """Cheap prefix check used to route Authorization headers to the PAT
    path instead of the JWT path. Does NOT validate the token."""
    return candidate.startswith(API_TOKEN_PREFIX)


def constant_time_equals(a: str, b: str) -> bool:
    """Timing-safe string comparison exposed for tests/callers that need it."""
    return hmac.compare_digest(a, b)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT. Returns claims dict or None if invalid/expired.

    Revocation is NOT checked here — that lives in deps.get_current_user
    because it needs DB session access. Keeping decode pure means the
    function stays callable from tests / CLI / background jobs without a
    full app context.
    """
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={
                # jti required so the revocation path has something to key
                # on. Old tokens minted before the jti rollout don't decode
                # — they'd be rejected here, forcing a fresh login. OK by
                # us: those were pre-v8 dev builds.
                "require": ["exp", "iat", "sub", "jti"],
                "verify_exp": True,
                "verify_iat": True,
                "verify_signature": True,
            },
        )
    except JWTError:
        return None
