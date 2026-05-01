"""One-shot invite tokens for the public `/join/:token` onboarding page.

Cierra VULN-04 del audit 2026-05-01: el plaintext del token NO se
persiste — solo el SHA-256 hex (`token_hash`) y los primeros 8 chars
(`token_prefix`) para identificación en la UI. Patrón replicado de
`models/api_token.py`.

API pública:
- :func:`generate_join_token` — devuelve `(plaintext, token_hash, token_prefix)`.
  El plaintext debe entregarse al cliente UNA VEZ y descartarse en el servidor.
- :func:`hash_join_token` — para el lookup en el handler `/api/join/{token}`.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime

from sqlmodel import Field, SQLModel


_RANDOM_BYTES = 32
_PREFIX_LEN = 8


def generate_join_token() -> tuple[str, str, str]:
    """Mint a fresh join token. Returns ``(plaintext, hash, prefix)``.

    Plaintext is ~43 chars (urlsafe-b64 de 32 bytes = 256 bits). Hash es
    SHA-256 hex — la entropía del plaintext ya es 256-bit, un colisión
    requeriría 2^128 tokens. Prefix son los primeros 8 chars del
    plaintext, persistidos para identificación en la UI sin exponer
    el resto.
    """
    plaintext = secrets.token_urlsafe(_RANDOM_BYTES)
    return (
        plaintext,
        hashlib.sha256(plaintext.encode("utf-8")).hexdigest(),
        plaintext[:_PREFIX_LEN],
    )


def hash_join_token(plaintext: str) -> str:
    """SHA-256 hex de un plaintext. Determinístico — usado en el handler
    para resolver el plaintext entrante a una fila por equality."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


class JoinToken(SQLModel, table=True):
    __tablename__ = "join_tokens"

    id: int | None = Field(default=None, primary_key=True)
    # SHA-256 hex (64 chars). Indexed + unique para el lookup O(log n)
    # desde `/api/join/{token}`. Nunca el plaintext.
    token_hash: str = Field(index=True, unique=True, max_length=64)
    # Primeros 8 chars del plaintext, persistidos para que la UI muestre
    # algo identificable sin almacenar el secreto completo.
    token_prefix: str = Field(default="", max_length=12)
    label: str | None = Field(default=None, max_length=128)  # e.g. "Abuela — laptop"
    created_by_user_id: int | None = Field(default=None, foreign_key="users.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    used_at: datetime | None = None
    revoked: bool = Field(default=False)
