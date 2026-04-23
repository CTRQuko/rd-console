"""Runtime-editable panel settings — /admin/api/settings/server-info.

Covers:
  - env defaults are returned when no override exists
  - PATCH writes overrides and the subsequent GET reflects them
  - empty-string value clears an override back to the env default
  - routers/join.py picks up live overrides without a restart
  - admin-only access
  - audit entry on change
"""

from __future__ import annotations

from sqlmodel import select

from app.config import get_settings
from app.models.audit_log import AuditAction, AuditLog
from app.models.runtime_setting import RuntimeSetting


def test_get_returns_env_defaults_when_no_override(client, auth_headers):
    s = get_settings()
    s.server_host = "env-host.example"
    s.panel_url = "https://env-panel.example"
    s.hbbs_public_key = "ENV_PUBKEY"
    r = client.get("/admin/api/settings/server-info", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["server_host"] == "env-host.example"
    assert body["panel_url"] == "https://env-panel.example"
    assert body["hbbs_public_key"] == "ENV_PUBKEY"


def test_patch_writes_override_and_get_reflects_it(client, auth_headers, session):
    r = client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"server_host": "overridden.example"},
    )
    assert r.status_code == 200
    assert r.json()["server_host"] == "overridden.example"

    r2 = client.get("/admin/api/settings/server-info", headers=auth_headers)
    assert r2.json()["server_host"] == "overridden.example"

    row = session.get(RuntimeSetting, "server_host")
    assert row is not None and row.value == "overridden.example"


def test_patch_empty_string_clears_override(client, auth_headers, session):
    # First set an override …
    client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"panel_url": "https://temp.example"},
    )
    # … then clear it.
    r = client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"panel_url": ""},
    )
    assert r.status_code == 200
    assert session.get(RuntimeSetting, "panel_url") is None
    # GET falls back to env.
    r2 = client.get("/admin/api/settings/server-info", headers=auth_headers)
    assert r2.json()["panel_url"] == get_settings().panel_url


def test_join_endpoint_uses_live_override_without_restart(
    client, auth_headers, session,
):
    """Regression guard: /api/join/:token reads via get_server_info, so
    admins do not need to redeploy to change the RustDesk host shown to
    invitees."""
    s = get_settings()
    s.server_host = "stale.example"
    s.panel_url = "https://stale-panel.example"
    s.hbbs_public_key = "STALE_PK"

    # Mint a join token first so the test doesn't depend on admin session
    # state when we override below.
    created = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={"label": "x"},
    ).json()

    # Now the operator overrides both the host and pubkey.
    client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"server_host": "live.example", "hbbs_public_key": "LIVE_PK"},
    )

    # Public fetch surfaces the live values, NOT the env values.
    r = client.get(f"/api/join/{created['token']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id_server"] == "live.example"
    assert body["public_key"] == "LIVE_PK"
    # Panel URL was not overridden — falls back to env.
    assert body["api_server"] == "https://stale-panel.example"


def test_patch_audit_entry_contains_changed_keys(client, auth_headers, session):
    client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"server_host": "a.example", "hbbs_public_key": "K"},
    )
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.SETTINGS_CHANGED)
    ).first()
    assert audit is not None
    # Keys listed sorted so the payload is stable / greppable.
    assert "hbbs_public_key" in (audit.payload or "")
    assert "server_host" in (audit.payload or "")


def test_patch_noop_when_no_fields_no_audit(client, auth_headers, session):
    """Empty PATCH body must not write a spurious audit row."""
    r = client.patch(
        "/admin/api/settings/server-info", headers=auth_headers, json={},
    )
    assert r.status_code == 200
    assert session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.SETTINGS_CHANGED)
    ).first() is None


def test_patch_requires_admin(client, make_user):
    make_user(username="regular", password="regular-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "regular", "password": "regular-pass-1234"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.patch(
        "/admin/api/settings/server-info",
        headers=headers,
        json={"server_host": "hacked.example"},
    )
    assert r.status_code == 403


def test_get_requires_admin(client, make_user):
    make_user(username="regular2", password="regular-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "regular2", "password": "regular-pass-1234"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(
        "/admin/api/settings/server-info", headers=headers,
    ).status_code == 403


def test_patch_rejects_oversize_value(client, auth_headers):
    """Keep DB writes bounded — server_host capped at 1024 chars."""
    r = client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"server_host": "x" * 2000},
    )
    assert r.status_code == 422


def test_export_returns_env_style_dump(client, auth_headers, session):
    """GET /export emits RD_*=value lines only for the editable keys and
    records an audit entry. Secrets are never surfaced."""
    # Set an override so the export has non-default content to show.
    client.patch(
        "/admin/api/settings/server-info",
        headers=auth_headers,
        json={"server_host": "exported.example"},
    )
    r = client.get("/admin/api/settings/export", headers=auth_headers)
    assert r.status_code == 200
    body = r.text
    assert "RD_SERVER_HOST=exported.example" in body
    assert "RD_PANEL_URL=" in body
    assert "RD_HBBS_PUBLIC_KEY=" in body
    # Secrets must never leak (check for the `KEY=` form — the names
    # appear in the NOTE comment on purpose).
    assert "RD_SECRET_KEY=" not in body
    assert "RD_ADMIN_PASSWORD=" not in body
    assert "RD_CLIENT_SHARED_SECRET=" not in body

    # Audit entry stamped.
    audit = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.SETTINGS_EXPORTED)
    ).first()
    assert audit is not None


def test_export_requires_admin(client, make_user):
    make_user(username="regular3", password="regular-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "regular3", "password": "regular-pass-1234"},
    )
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/admin/api/settings/export", headers=headers).status_code == 403


def test_existing_joinToken_test_still_works(client, auth_headers):
    """Trip-wire: the existing test_created_token_unlocks_public_join still
    expects the env host to be visible when no override exists. Running
    the same flow here to confirm the refactor didn't accidentally break
    the "no override" path."""
    s = get_settings()
    s.server_host = "no-override.example"
    s.panel_url = "https://no-override-panel.example"
    s.hbbs_public_key = "NO_OVERRIDE_PK"
    created = client.post(
        "/admin/api/join-tokens", headers=auth_headers, json={},
    ).json()
    r = client.get(f"/api/join/{created['token']}")
    assert r.status_code == 200
    assert r.json()["id_server"] == "no-override.example"
