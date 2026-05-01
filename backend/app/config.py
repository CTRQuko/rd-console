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

    # When true, `_mount_frontend()` skips the SPA serving entirely — useful
    # when the same backend image ships in two roles: "API + panel" (default)
    # and "API only" (this instance's frontend is served from elsewhere, e.g.
    # a staging nginx on a different host). With the frontend off, every
    # non-API GET returns a 404 from FastAPI instead of a maybe-stale SPA
    # shell — no risk of a misconfigured reverse proxy accidentally routing
    # an unrelated hostname into a rd-console login page.
    disable_frontend: bool = False

    # ─── RustDesk server (shown to clients on the /join page) ───
    server_host: str = Field(default="", description="Hostname of the RustDesk hbbs/hbbr server")
    panel_url: str = Field(default="", description="Public URL of this panel")
    panel_name: str = Field(default="", description="Operator-facing label for this relay; shown in the topbar and notification subjects")
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

    # Debug switch: when true, log the full raw body of every POST to
    # /api/audit/conn at INFO level under the "rd_console.audit" logger.
    # Used during Flutter-client investigation spikes to discover any new
    # fields upstream started sending. Keep OFF in normal production —
    # peer IDs + IPs landing in application logs is PII for some ops.
    debug_raw_audit_conn: bool = Field(default=False)

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

    # Lista de proxies de confianza (IPs literales o redes CIDR). Solo se
    # honra `X-Forwarded-For` cuando la conexión TCP directa viene de una
    # de estas redes. Vacío por defecto = NO se confía en XFF y el rate
    # limiter / audit log usan siempre la IP del socket directo. Cierra
    # VULN-01 / VULN-10 del audit 2026-05-01.
    # Ejemplos: ["127.0.0.1", "10.0.0.0/8", "fd00::/8"].
    trusted_proxies: list[str] = Field(default_factory=list)

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

    @field_validator("admin_password")
    @classmethod
    def _validate_admin_password(cls, v: str, info) -> str:
        """En `prod`, si se setea bootstrap admin password debe ser
        sólido. Cierra VULN-11 del audit 2026-05-01: previamente se
        aceptaba cualquier valor no-vacío incluyendo `admin`/`123456`."""
        env = (info.data or {}).get("environment", "dev")
        if env == "prod" and v:
            if len(v) < 12:
                raise ValueError(
                    "RD_ADMIN_PASSWORD must be ≥ 12 characters in production"
                )
            common = {"admin", "password", "12345678", "qwerty12", "letmein1", "changeme"}
            if v.lower() in common or v.lower() in {"admin1234567", "password1234"}:
                raise ValueError(
                    "RD_ADMIN_PASSWORD is in the common-passwords list — "
                    "use a unique value (e.g. `openssl rand -base64 24`)"
                )
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
