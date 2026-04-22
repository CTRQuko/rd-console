"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # ─── RustDesk server (shown to clients on the /join page) ───
    server_host: str = Field(default="", description="Hostname of the RustDesk hbbs/hbbr server")
    panel_url: str = Field(default="", description="Public URL of this panel")
    hbbs_public_key: str = Field(default="", description="Contents of id_ed25519.pub")

    # ─── Security ───
    secret_key: str = Field(default="change-me-in-production-32-chars-min")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 h

    # ─── Database ───
    db_path: Path = Field(default=Path("/data/rd_console.sqlite3"))

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


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
