"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_SECRET = "change-me-in-production-32-chars-min"  # noqa: S105


class Settings(BaseSettings):
    """Application settings.

    All variables are read from the environment (or a local `.env` file during
    development). Names are prefixed with ``RD_`` on the environment side but
    exposed without prefix on the model for ergonomic access.
    """

    model_config = SettingsConfigDict(
        env_prefix="RD_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ─── Environment ───
    environment: Literal["dev", "prod"] = "dev"

    # ─── RustDesk server (shown to clients on the /join page) ───
    server_host: str = Field(default="", description="Hostname of the RustDesk hbbs/hbbr server")
    panel_url: str = Field(default="", description="Public URL of this panel")
    hbbs_public_key: str = Field(default="", description="Contents of id_ed25519.pub")

    # ─── Security ───
    secret_key: str = Field(default=_DEFAULT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 h

    # Optional shared secret required for RustDesk client-protocol endpoints
    # (/api/heartbeat, /api/sysinfo, /api/audit/*). When empty, the endpoints
    # accept unauthenticated traffic — keep backward compatible, but log a
    # warning at startup. See main.py.
    client_shared_secret: str = Field(default="")

    # Maximum bytes we will persist in AuditLog.payload from client protocol
    # events. Prevents a malicious client from filling the DB.
    max_audit_payload_bytes: int = Field(default=4096, ge=256, le=65536)

    # ─── Database ───
    db_path: Path = Field(default=Path("/data/rd_console.sqlite3"))

    # Path to the hbbs SQLite we mount read-only as a sidecar. When the file
    # exists, a background task syncs its `peer` table into our `devices`
    # table. Default points at the in-container mount defined in the
    # production docker-compose.
    hbbs_db_path: Path = Field(default=Path("/hbbs-data/db_v2.sqlite3"))
    # Seconds between hbbs sync ticks. Clamped to ≥ 5s at use-site so a
    # misconfigured "0" doesn't peg the CPU.
    hbbs_sync_interval: int = Field(default=30, ge=5, le=3600)

    # ─── Bootstrap admin (created on first start if no admin exists) ───
    admin_username: str = "admin"
    admin_password: str = ""  # if empty, admin is NOT auto-created

    # ─── Server ───
    port: int = 8080
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )

    # ─── Validators ───
    @field_validator("secret_key")
    @classmethod
    def _validate_secret_key(cls, v: str, info) -> str:
        env = (info.data or {}).get("environment", "dev")
        if env == "prod":
            if v == _DEFAULT_SECRET:
                raise ValueError(
                    "RD_SECRET_KEY must be set to a unique value in production"
                )
            if len(v) < 32:
                raise ValueError("RD_SECRET_KEY must be at least 32 characters long")
        return v

    @field_validator("cors_origins")
    @classmethod
    def _validate_cors(cls, v: list[str]) -> list[str]:
        # Reject wildcard — we use allow_credentials=True which forbids it.
        if any(o.strip() == "*" for o in v):
            raise ValueError("RD_CORS_ORIGINS cannot contain '*' when credentials are allowed")
        return v


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
