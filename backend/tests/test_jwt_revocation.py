"""JWT revocation — per-token (jti) deny-list.

Contract:
  - Every JWT issued by create_access_token carries a unique jti claim.
  - get_current_user rejects tokens whose jti is present in jwt_revocations.
  - POST /api/auth/logout upserts the current token's jti into the list.
  - POST /api/logout (legacy Flutter alias) does the same; shape stays
    {"code": 1}.
  - Revocation is per-token: user1's logout does not affect user2.
  - A background coroutine purges rows whose expires_at is in the past.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from sqlmodel import select

from app.models.jwt_revocation import JwtRevocation
from app.security import (
    create_access_token,
    decode_access_token,
    utcnow_naive,
)


# ─── 1. jti claim on every token ──────────────────────────────────────────────


def test_jwt_has_jti_claim():
    token = create_access_token(subject=42)
    claims = decode_access_token(token)
    assert claims is not None
    assert "jti" in claims, "every JWT must carry a jti for revocation"
    assert len(claims["jti"]) >= 16, "jti must be long enough to avoid collisions"


# ─── 2. Expired tokens reject without touching the revocation table ───────────


def test_expired_token_rejected_without_db_lookup(client, admin_user, session):
    expired = create_access_function_expired(admin_user.id)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    # Table remains empty — expired branch short-circuits before the lookup.
    rows = session.exec(select(JwtRevocation)).all()
    assert rows == []


def create_access_function_expired(user_id: int) -> str:
    """Helper: mint a token that already expired."""
    return create_access_token(
        subject=user_id,
        expires_delta=timedelta(seconds=-1),
    )


# ─── 3. Revoked jti rejected with 401 ─────────────────────────────────────────


def test_revoked_jti_rejected_401(client, admin_user, admin_token, session):
    claims = decode_access_token(admin_token)
    jti = claims["jti"]
    session.add(
        JwtRevocation(
            jti=jti,
            user_id=admin_user.id,
            expires_at=utcnow_naive() + timedelta(hours=1),
        )
    )
    session.commit()
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 401


# ─── 4. Panel /api/auth/logout revokes current token ──────────────────────────


def test_panel_logout_revokes_current_token(client, admin_token, session):
    # Baseline: token works.
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200

    r = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 204

    # Second hit is rejected — JWT was valid but jti is now in the deny list.
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 401

    rows = session.exec(select(JwtRevocation)).all()
    assert len(rows) == 1
    claims = decode_access_token(admin_token)
    assert rows[0].jti == claims["jti"]


# ─── 5. Per-token granularity: user2 not affected by user1's logout ───────────


def test_panel_logout_does_not_affect_other_users(client, make_user):
    user_a = make_user(username="alice", password="password-aaaa")
    user_b = make_user(username="bob",   password="password-bbbb")

    token_a = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "password-aaaa"},
    ).json()["access_token"]
    token_b = client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "password-bbbb"},
    ).json()["access_token"]

    r = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 204

    # Alice dies, Bob lives.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_a}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token_b}"}).status_code == 200


# ─── 6. Legacy Flutter logout revokes + keeps kingmo888 shape ─────────────────


def test_legacy_flutter_logout_revokes_current_token(client, make_user, session):
    make_user(username="flutter", password="pw-pw-pw-pw")
    login = client.post(
        "/api/login",
        json={"username": "flutter", "password": "pw-pw-pw-pw"},
    )
    token = login.json()["access_token"]

    # Baseline: token works against /api/currentUser.
    r = client.post("/api/currentUser", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200

    r = client.post(
        "/api/logout",
        json={"id": "1779980041", "uuid": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    # kingmo888 contract preserved — client branches on `code == 1`.
    assert r.json() == {"code": 1}

    r = client.post("/api/currentUser", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401

    rows = session.exec(select(JwtRevocation)).all()
    assert len(rows) == 1


def test_legacy_logout_without_auth_header_still_returns_code_1(client):
    """The Flutter client sometimes calls /api/logout after a session drop
    where the token is already gone. We must still return {code:1} so the
    client's sign-out flow completes cleanly — no crash, no revocation row."""
    from sqlmodel import select as _sel

    from app.db import engine
    from sqlmodel import Session

    r = client.post("/api/logout", json={"id": "x", "uuid": "y"})
    assert r.status_code == 200
    assert r.json() == {"code": 1}

    with Session(engine) as s:
        assert s.exec(_sel(JwtRevocation)).all() == []


# ─── 7 & 8. Background cleanup coroutine ──────────────────────────────────────


@pytest.mark.asyncio
async def test_cleanup_purges_expired_revocations(session):
    from app.services.jwt_cleanup import purge_expired_revocations

    session.add(
        JwtRevocation(
            jti="stale-row",
            user_id=1,
            expires_at=utcnow_naive() - timedelta(hours=1),
        )
    )
    session.commit()

    removed = await purge_expired_revocations()
    assert removed == 1
    assert session.exec(select(JwtRevocation)).all() == []


@pytest.mark.asyncio
async def test_cleanup_preserves_live_revocations(session):
    from app.services.jwt_cleanup import purge_expired_revocations

    session.add(
        JwtRevocation(
            jti="fresh-row",
            user_id=1,
            expires_at=utcnow_naive() + timedelta(hours=1),
        )
    )
    session.commit()

    removed = await purge_expired_revocations()
    assert removed == 0
    rows = session.exec(select(JwtRevocation)).all()
    assert len(rows) == 1
    assert rows[0].jti == "fresh-row"
