"""Config validators."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_prod_rejects_default_secret(monkeypatch):
    monkeypatch.setenv("RD_ENVIRONMENT", "prod")
    monkeypatch.setenv("RD_SECRET_KEY", "change-me-in-production-32-chars-min")
    with pytest.raises(ValidationError):
        Settings()


def test_prod_rejects_short_secret(monkeypatch):
    monkeypatch.setenv("RD_ENVIRONMENT", "prod")
    monkeypatch.setenv("RD_SECRET_KEY", "short")
    with pytest.raises(ValidationError):
        Settings()


def test_prod_accepts_strong_secret(monkeypatch):
    monkeypatch.setenv("RD_ENVIRONMENT", "prod")
    monkeypatch.setenv("RD_SECRET_KEY", "x" * 48)
    s = Settings()
    assert s.environment == "prod"


def test_cors_rejects_wildcard(monkeypatch):
    monkeypatch.setenv("RD_CORS_ORIGINS", '["*"]')
    with pytest.raises(ValidationError):
        Settings()
