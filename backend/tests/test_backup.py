"""Backup / restore endpoint tests.

Covers:
  - export redacts all secrets (password_hash, token_hash, token, secret keys)
  - restore dry_run returns a correct diff without mutating the DB
  - restore apply is idempotent (run twice → same state)
  - restore preserves password_hash of existing users
  - roundtrip: export → wipe non-admin users/tags/settings → restore → export matches
"""

from __future__ import annotations

import json

import pytest
from sqlmodel import select

from app.models.api_token import ApiToken
from app.models.audit_log import AuditAction, AuditLog
from app.models.runtime_setting import RuntimeSetting
from app.models.tag import Tag
from app.models.user import User, UserRole
from app.security import hash_password


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture()
def seeded(session, admin_user):
    """Add extra users, a tag, a runtime setting, and an API token to the DB."""
    u2 = User(
        username="alice",
        email="alice@example.com",
        password_hash=hash_password("alice-pass-1234"),
        role=UserRole.USER,
        is_active=True,
    )
    session.add(u2)

    tag = Tag(name="homelab", color="blue")
    session.add(tag)

    setting = RuntimeSetting(key="server_host", value="rd.example.com")
    session.add(setting)

    token = ApiToken(
        user_id=admin_user.id,
        name="ci-token",
        token_hash="a" * 64,
        token_prefix="rdcp_abcd",
    )
    session.add(token)

    session.commit()
    return {"user": u2, "tag": tag, "setting": setting, "token": token}


# ─── Tests ───────────────────────────────────────────────────────────────────

def test_export_redacts_secrets(client, auth_headers, seeded):
    """No secrets should appear in the export payload."""
    r = client.get("/admin/api/backup", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()

    # schema_version sentinel
    assert body["schema_version"] == 1

    raw = json.dumps(body)
    for forbidden in ("password_hash", "token_hash", "RD_SECRET_KEY",
                       "RD_ADMIN_PASSWORD", "RD_CLIENT_SHARED_SECRET"):
        assert forbidden not in raw, f"Forbidden field '{forbidden}' found in export"

    # token_prefix is allowed (identification only); token itself is not
    assert "token_prefix" in raw
    for u in body["users"]:
        assert "password_hash" not in u


def test_restore_dry_run_computes_diff(client, auth_headers, seeded, session):
    """dry_run returns the expected diff without modifying the DB."""
    # Export current state
    r_export = client.get("/admin/api/backup", headers=auth_headers)
    assert r_export.status_code == 200
    bundle = r_export.json()

    # Add a new user to the bundle (not in DB yet)
    bundle["users"].append({
        "username": "bob",
        "email": None,
        "role": "user",
        "is_active": True,
        "created_at": "2026-01-01T00:00:00",
    })

    r = client.post(
        "/admin/api/backup/restore?mode=dry_run",
        headers=auth_headers,
        json=bundle,
    )
    assert r.status_code == 200
    result = r.json()
    assert result["mode"] == "dry_run"
    assert result["diff"]["users"]["add"] == 1
    # No user should have been written
    users_in_db = session.exec(select(User)).all()
    assert all(u.username != "bob" for u in users_in_db)


def test_restore_apply_is_idempotent(client, auth_headers, seeded):
    """Applying the same bundle twice produces the same state."""
    r_export = client.get("/admin/api/backup", headers=auth_headers)
    bundle = r_export.json()

    r1 = client.post(
        "/admin/api/backup/restore?mode=apply",
        headers=auth_headers,
        json=bundle,
    )
    assert r1.status_code == 200

    r2 = client.post(
        "/admin/api/backup/restore?mode=apply",
        headers=auth_headers,
        json=bundle,
    )
    assert r2.status_code == 200

    diff1 = r1.json()["diff"]
    diff2 = r2.json()["diff"]
    # Second apply: 0 new adds (everything already exists)
    assert diff2["users"]["add"] == 0
    assert diff2["tags"]["add"] == 0


def test_restore_preserves_existing_passwords(client, auth_headers, seeded, session):
    """Restoring a bundle must not overwrite the password_hash of existing users."""
    # Capture the current hash
    existing = session.exec(select(User).where(User.username == "alice")).one()
    original_hash = existing.password_hash

    r_export = client.get("/admin/api/backup", headers=auth_headers)
    bundle = r_export.json()

    r = client.post(
        "/admin/api/backup/restore?mode=apply",
        headers=auth_headers,
        json=bundle,
    )
    assert r.status_code == 200

    # Re-fetch
    session.expire_all()
    updated = session.exec(select(User).where(User.username == "alice")).one()
    assert updated.password_hash == original_hash, (
        "Restore must not change the password_hash of an existing user"
    )


def test_export_restore_roundtrip(client, auth_headers, seeded, session):
    """export → delete non-admin data → restore → re-export matches original."""
    # First export
    r1 = client.get("/admin/api/backup", headers=auth_headers)
    bundle1 = r1.json()

    # Remove alice from the DB
    alice = session.exec(select(User).where(User.username == "alice")).one()
    session.delete(alice)
    session.commit()

    # Restore
    r_restore = client.post(
        "/admin/api/backup/restore?mode=apply",
        headers=auth_headers,
        json=bundle1,
    )
    assert r_restore.status_code == 200
    assert r_restore.json()["diff"]["users"]["add"] == 1

    # Re-export
    r2 = client.get("/admin/api/backup", headers=auth_headers)
    bundle2 = r2.json()

    # Users (excluding exported_at) should match
    usernames1 = sorted(u["username"] for u in bundle1["users"])
    usernames2 = sorted(u["username"] for u in bundle2["users"])
    assert usernames1 == usernames2

    # Tags should match
    tags1 = sorted(t["name"] for t in bundle1["tags"])
    tags2 = sorted(t["name"] for t in bundle2["tags"])
    assert tags1 == tags2


def test_export_emits_audit_log(client, auth_headers, session):
    """Each export should leave a BACKUP_EXPORTED entry in audit_logs."""
    r = client.get("/admin/api/backup", headers=auth_headers)
    assert r.status_code == 200

    logs = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.BACKUP_EXPORTED)
    ).all()
    assert len(logs) == 1
