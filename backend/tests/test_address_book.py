"""Address book — legacy RustDesk-compatible contract tests.

Roundtrip test goes FIRST (per pre-implementation review): the whole
feature hinges on preserving the stringified-JSON envelope byte-for-byte.
If that breaks, Flutter clients silently wipe their local AB and the
regression is invisible until a user complains.
"""

from __future__ import annotations

import json

from sqlmodel import select

from app.models.audit_log import AuditAction, AuditLog

# ─── 1. Double-JSON roundtrip (the load-bearing test) ───────────────────────


def test_ab_roundtrip_preserves_inner_json_verbatim(client, auth_headers):
    """POST /api/ab then POST /api/ab/get — the `data` string must come
    back byte-identical, and parsing it must yield the original object."""
    inner = {
        "tags": ["home", "work"],
        "peers": [
            {
                "id": "1779980041",
                "username": "jandro",
                "hostname": "desktop",
                "alias": "",
                "platform": "Windows",
                "tags": ["home"],
                "hash": "",
            },
        ],
        "tag_colors": json.dumps({"home": -16711936, "work": -65536}),
    }
    stringified = json.dumps(inner, separators=(",", ":"), sort_keys=True)

    put = client.post("/api/ab", headers=auth_headers, json={"data": stringified})
    assert put.status_code == 200, put.text
    assert "updated_at" in put.json()

    got = client.post("/api/ab/get", headers=auth_headers, json={"id": "whatever"})
    assert got.status_code == 200, got.text
    body = got.json()
    # Byte-identical: this is the whole point.
    assert body["data"] == stringified
    # And it still parses to the original object.
    assert json.loads(body["data"]) == inner


def test_ab_roundtrip_preserves_unknown_forward_compat_fields(client, auth_headers):
    """Future RustDesk versions add fields we don't know about. We must
    never strip them — store verbatim, return verbatim."""
    stringified = json.dumps(
        {
            "tags": [],
            "peers": [],
            "tag_colors": "{}",
            # Hypothetical future fields:
            "forced_alias_prefix": "home-",
            "schema_version": 99,
        }
    )
    client.post("/api/ab", headers=auth_headers, json={"data": stringified}).raise_for_status()
    got = client.post("/api/ab/get", headers=auth_headers, json={}).json()
    assert json.loads(got["data"])["forced_alias_prefix"] == "home-"
    assert json.loads(got["data"])["schema_version"] == 99


# ─── 2. Per-user isolation ──────────────────────────────────────────────────


def test_ab_is_per_user(client, make_user):
    """Alice's AB must not leak into Bob's response."""
    make_user(username="alice", password="alice-pass-1234")
    make_user(username="bob", password="bob-pass-12345")

    def login(u, p):
        r = client.post("/api/auth/login", json={"username": u, "password": p})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    alice = login("alice", "alice-pass-1234")
    bob = login("bob", "bob-pass-12345")

    client.post("/api/ab", headers=alice, json={"data": '{"peers":["alice-only"]}'}).raise_for_status()

    # Alice sees hers.
    a = client.post("/api/ab/get", headers=alice, json={}).json()
    assert "alice-only" in a["data"]

    # Bob sees empty — never Alice's blob.
    b = client.post("/api/ab/get", headers=bob, json={}).json()
    assert b["data"] == ""
    assert b["updated_at"] is None


# ─── 3. Full-replace semantics ──────────────────────────────────────────────


def test_ab_put_is_full_replace(client, auth_headers):
    """Second PUT fully overwrites the first — no merge, no diff."""
    first = json.dumps({"peers": [{"id": "AAA"}]})
    second = json.dumps({"peers": [{"id": "BBB"}]})

    client.post("/api/ab", headers=auth_headers, json={"data": first}).raise_for_status()
    client.post("/api/ab", headers=auth_headers, json={"data": second}).raise_for_status()

    got = client.post("/api/ab/get", headers=auth_headers, json={}).json()
    assert got["data"] == second
    assert "AAA" not in got["data"]


# ─── 4. Empty AB → empty response (not 404) ─────────────────────────────────


def test_ab_get_empty_returns_200_with_empty_string(client, auth_headers):
    got = client.post("/api/ab/get", headers=auth_headers, json={"id": "x"})
    assert got.status_code == 200
    assert got.json() == {"updated_at": None, "data": ""}


# ─── 5. Auth required ───────────────────────────────────────────────────────


def test_ab_requires_auth(client):
    assert client.post("/api/ab/get", json={}).status_code == 401
    assert client.post("/api/ab", json={"data": "{}"}).status_code == 401


# ─── 6. Flutter compat probes MUST 404 (load-bearing) ───────────────────────


def test_ab_settings_probe_returns_404(client, auth_headers):
    """If this ever returns 200, newer Flutter clients switch to a
    v2 shared-AB API we don't implement, and everything breaks silently."""
    for method in ("get", "post"):
        r = getattr(client, method)("/api/ab/settings", headers=auth_headers)
        assert r.status_code == 404, f"{method.upper()} /api/ab/settings returned {r.status_code}"


def test_ab_personal_probe_returns_404(client, auth_headers):
    for method in ("get", "post"):
        r = getattr(client, method)("/api/ab/personal", headers=auth_headers)
        assert r.status_code == 404, f"{method.upper()} /api/ab/personal returned {r.status_code}"


# ─── 7. Audit logging ───────────────────────────────────────────────────────


def test_ab_put_emits_updated_audit(client, auth_headers, session, admin_user):
    stringified = json.dumps({"peers": [{"id": "XYZ"}]})
    client.post("/api/ab", headers=auth_headers, json={"data": stringified}).raise_for_status()

    rows = session.exec(
        select(AuditLog).where(AuditLog.actor_user_id == admin_user.id)
    ).all()
    actions = [r.action for r in rows]
    assert AuditAction.ADDRESS_BOOK_UPDATED in actions
    # Payload carries size + preview but NEVER the full blob.
    updated_rows = [r for r in rows if r.action == AuditAction.ADDRESS_BOOK_UPDATED]
    assert all("bytes=" in (r.payload or "") for r in updated_rows)


def test_ab_put_empty_emits_cleared_audit(client, auth_headers, session, admin_user):
    client.post("/api/ab", headers=auth_headers, json={"data": "{}"}).raise_for_status()
    rows = session.exec(
        select(AuditLog)
        .where(AuditLog.actor_user_id == admin_user.id)
        .where(AuditLog.action == AuditAction.ADDRESS_BOOK_CLEARED)
    ).all()
    assert len(rows) == 1


# ─── 8. Size cap rejects oversized blobs ────────────────────────────────────


def test_ab_put_rejects_oversized_blob(client, auth_headers):
    huge = "x" * (10 * 1024 * 1024 + 1)  # 10 MiB + 1 byte
    r = client.post("/api/ab", headers=auth_headers, json={"data": huge})
    # Pydantic v2 raises 422 on max_length violation.
    assert r.status_code == 422


# ─── 9. PAT auth works on AB too ────────────────────────────────────────────


def test_ab_accepts_personal_access_token(client, auth_headers):
    """A PAT minted by the user must auth AB the same as a JWT — this is
    how a sync cron would push AB updates without a password."""
    mint = client.post(
        "/api/auth/tokens",
        headers=auth_headers,
        json={"name": "ab-sync-cron"},
    )
    assert mint.status_code == 201, mint.text
    pat = mint.json()["token"]

    pat_headers = {"Authorization": f"Bearer {pat}"}
    stringified = json.dumps({"peers": [{"id": "PAT-PUSH"}]})
    put = client.post("/api/ab", headers=pat_headers, json={"data": stringified})
    assert put.status_code == 200, put.text

    got = client.post("/api/ab/get", headers=pat_headers, json={})
    assert "PAT-PUSH" in got.json()["data"]
