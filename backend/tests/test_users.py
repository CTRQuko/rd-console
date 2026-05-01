"""User admin: disable-self guard, last-admin guard, hard-delete, bulk."""

from __future__ import annotations

from sqlmodel import select

from app.models.address_book import AddressBook
from app.models.api_token import ApiToken
from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device
from app.models.join_token import JoinToken
from app.models.user import User, UserRole
from app.security import api_token_display_prefix, hash_api_token, utcnow_naive


def test_cannot_disable_self(client, admin_user, auth_headers):
    r = client.delete(f"/admin/api/users/{admin_user.id}", headers=auth_headers)
    assert r.status_code == 400


def test_cannot_demote_last_admin(client, admin_user, auth_headers):
    """PATCH role=user on the last admin must fail — regression for F-6."""
    r = client.patch(
        f"/admin/api/users/{admin_user.id}",
        headers=auth_headers,
        json={"role": "user"},
    )
    assert r.status_code == 400


def test_can_demote_peer_admin_if_another_admin_exists(client, admin_user, make_user, auth_headers):
    # admin_user is id=1 (initial admin, protected). We demote a PEER admin
    # to exercise the "not last admin" branch. Demoting id=1 is covered by
    # the initial-admin protection tests further down.
    peer = make_user(username="admin2", password="admin2pass1234", role=UserRole.ADMIN)
    r = client.patch(
        f"/admin/api/users/{peer.id}",
        headers=auth_headers,
        json={"role": "user"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "user"


def test_create_user_conflict_on_duplicate_username(client, make_user, auth_headers):
    make_user(username="dup", password="duppppppp")
    r = client.post(
        "/admin/api/users",
        headers=auth_headers,
        json={"username": "dup", "password": "duppppppp"},
    )
    assert r.status_code == 409


def test_create_user_validates_password_length(client, auth_headers):
    r = client.post(
        "/admin/api/users",
        headers=auth_headers,
        json={"username": "newbie", "password": "short"},
    )
    assert r.status_code == 422


# ─── Hard delete ────────────────────────────────────────────────────────────


def test_hard_delete_removes_user_and_cascades(
    client, admin_user, make_user, auth_headers, session,
):
    """?hard=true wipes the user row, its PATs, and its address book;
    preserves devices/join-tokens/audit rows with NULL owner/actor."""
    victim = make_user(username="victim", password="victim-pass-1234")
    victim_id = victim.id
    # Seed dependents so we can prove the cascade.
    session.add(ApiToken(
        user_id=victim_id,
        name="pat1",
        token_hash=hash_api_token("rdcp_secret_aaaaaaaaaaaa"),
        token_prefix=api_token_display_prefix("rdcp_secret_aaaaaaaaaaaa"),
        created_at=utcnow_naive(),
    ))
    session.add(AddressBook(user_id=victim_id, payload="{}"))
    session.add(Device(rustdesk_id="DEVICEOWNED", owner_user_id=victim_id))
    # JoinToken post VULN-04: hash + prefix obligatorios.
    from app.models.join_token import generate_join_token
    _, _jt_hash, _jt_prefix = generate_join_token()
    session.add(JoinToken(
        token_hash=_jt_hash,
        token_prefix=_jt_prefix,
        label="by-victim",
        created_by_user_id=victim_id,
    ))
    session.commit()

    r = client.delete(
        f"/admin/api/users/{victim_id}?hard=true", headers=auth_headers,
    )
    assert r.status_code == 204

    # TestClient commits in its own session. Close our identity map entirely
    # so the subsequent queries see the post-delete state of the DB (and
    # don't try to refresh `victim`, which is now a deleted instance).
    session.expunge_all()
    # User row gone.
    assert session.get(User, victim_id) is None
    # PATs gone.
    assert session.exec(
        select(ApiToken).where(ApiToken.user_id == victim_id)
    ).first() is None
    # Address book gone.
    assert session.exec(
        select(AddressBook).where(AddressBook.user_id == victim_id)
    ).first() is None
    # Device + join token preserved with NULL owner.
    device = session.exec(
        select(Device).where(Device.rustdesk_id == "DEVICEOWNED")
    ).first()
    assert device is not None and device.owner_user_id is None
    jt = session.exec(
        select(JoinToken).where(JoinToken.label == "by-victim")
    ).first()
    assert jt is not None and jt.created_by_user_id is None
    # Audit entry present.
    assert session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.USER_DELETED)
    ).first() is not None


def test_hard_delete_blocks_last_admin(client, admin_user, auth_headers):
    r = client.delete(
        f"/admin/api/users/{admin_user.id}?hard=true", headers=auth_headers,
    )
    # Self-check trips first (cannot remove yourself); just confirm we never
    # nuke the last admin regardless of which guardrail fires.
    assert r.status_code == 400


def test_hard_delete_blocks_other_last_admin(
    client, make_user, admin_user, auth_headers, session,
):
    """Demote path covered elsewhere; this covers hard-delete of the ONLY
    other active admin while calling user is also admin — the guardrail
    must still keep at least one active admin in the table."""
    # admin_user is the caller; kill its only peer, leaving admin_user alone.
    peer = make_user(username="peer", password="peer-pass-1234", role=UserRole.ADMIN)
    # Disable peer first → now admin_user is the only active admin. Attempt
    # to hard-delete peer anyway: should succeed (peer is not active, so
    # removing it doesn't remove an active admin).
    peer.is_active = False
    session.add(peer)
    session.commit()

    r = client.delete(
        f"/admin/api/users/{peer.id}?hard=true", headers=auth_headers,
    )
    assert r.status_code == 204

    # But deleting admin_user (the last active admin) must be blocked.
    r = client.delete(
        f"/admin/api/users/{admin_user.id}?hard=true", headers=auth_headers,
    )
    assert r.status_code == 400


def test_default_delete_still_disables(client, make_user, auth_headers, session):
    """No ?hard → legacy behaviour (soft disable). Regression guard."""
    u = make_user(username="softy", password="softy-pass-1234")
    r = client.delete(f"/admin/api/users/{u.id}", headers=auth_headers)
    assert r.status_code == 204
    session.refresh(u)
    assert u.is_active is False
    # Row still present.
    assert session.get(User, u.id) is not None


# ─── Bulk ops ───────────────────────────────────────────────────────────────


def test_bulk_disable_multiple(client, make_user, auth_headers, session):
    a = make_user(username="a", password="aaaaaaaa-pass")
    b = make_user(username="b", password="bbbbbbbb-pass")
    r = client.post(
        "/admin/api/users/bulk",
        headers=auth_headers,
        json={"action": "disable", "user_ids": [a.id, b.id]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 2
    assert body["skipped"] == []
    session.refresh(a)
    session.refresh(b)
    assert a.is_active is False and b.is_active is False


def test_bulk_delete_skips_self_and_last_admin(
    client, admin_user, make_user, auth_headers, session,
):
    victim = make_user(username="bulkvictim", password="bulk-pass-1234")
    r = client.post(
        "/admin/api/users/bulk",
        headers=auth_headers,
        # Include admin_user (self), a valid victim, and a non-existent id.
        json={"action": "delete", "user_ids": [admin_user.id, victim.id, 99999]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 1
    reasons = {row["user_id"]: row["reason"] for row in body["skipped"]}
    assert reasons[admin_user.id] == "self"
    assert reasons[99999] == "not_found"
    # Victim gone — the TestClient uses its own session so we must expire
    # the fixture session's identity map to see the delete committed by
    # the request handler.
    victim_id = victim.id
    session.expunge_all()
    assert session.get(User, victim_id) is None


def test_bulk_enable_is_idempotent(client, make_user, auth_headers):
    a = make_user(username="eager", password="eager-pass-1234")
    r = client.post(
        "/admin/api/users/bulk",
        headers=auth_headers,
        json={"action": "enable", "user_ids": [a.id]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 0
    assert body["skipped"] == [{"user_id": a.id, "reason": "already_enabled"}]


def test_bulk_rejects_empty_payload(client, auth_headers):
    r = client.post(
        "/admin/api/users/bulk",
        headers=auth_headers,
        json={"action": "delete", "user_ids": []},
    )
    assert r.status_code == 422


def test_bulk_rejects_non_admin(client, make_user):
    """Regression: bulk is admin-only. A regular user must 403."""
    make_user(username="plain", password="plain-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "plain", "password": "plain-pass-1234"},
    )
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post(
        "/admin/api/users/bulk",
        headers=headers,
        json={"action": "disable", "user_ids": [1]},
    )
    assert r.status_code == 403


# ─── Initial admin protection ───────────────────────────────────────────────
#
# The admin fixture seeds id=1, which is the bootstrap admin by convention.
# Jandro wants this row strictly untouchable — even when there are other
# admins around to satisfy the last-admin guard, the id=1 row must resist
# delete / hard-delete / disable.


def test_initial_admin_cannot_be_hard_deleted_even_with_peer_admin(
    client, admin_user, make_user, auth_headers, session,
):
    """Create a peer admin (id>1), log in as peer, try to hard-delete id=1."""
    peer = make_user(
        username="peer", password="peer-pass-1234", role=UserRole.ADMIN,
    )
    # Authenticate as peer.
    r = client.post(
        "/api/auth/login",
        json={"username": "peer", "password": "peer-pass-1234"},
    )
    peer_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.delete(
        f"/admin/api/users/{admin_user.id}?hard=true", headers=peer_headers,
    )
    assert r.status_code == 400
    assert "initial admin" in r.json()["detail"].lower()
    # Row still there.
    session.expire_all()
    assert session.get(User, admin_user.id) is not None
    # Peer stayed intact too.
    assert peer.id is not None


def test_initial_admin_cannot_be_soft_disabled_even_with_peer_admin(
    client, admin_user, make_user, session,
):
    make_user(username="peer2", password="peer-pass-1234", role=UserRole.ADMIN)
    r = client.post(
        "/api/auth/login",
        json={"username": "peer2", "password": "peer-pass-1234"},
    )
    peer_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.delete(f"/admin/api/users/{admin_user.id}", headers=peer_headers)
    assert r.status_code == 400
    session.expire_all()
    still = session.get(User, admin_user.id)
    assert still is not None and still.is_active is True


def test_initial_admin_cannot_be_disabled_via_patch(
    client, admin_user, make_user,
):
    """PATCH with is_active=False on id=1 must fail even from a peer admin."""
    make_user(username="peer3", password="peer-pass-1234", role=UserRole.ADMIN)
    r = client.post(
        "/api/auth/login",
        json={"username": "peer3", "password": "peer-pass-1234"},
    )
    peer_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.patch(
        f"/admin/api/users/{admin_user.id}",
        headers=peer_headers,
        json={"is_active": False},
    )
    assert r.status_code == 400
    assert "initial admin" in r.json()["detail"].lower()


def test_initial_admin_cannot_be_demoted_via_patch(
    client, admin_user, make_user,
):
    make_user(username="peer4", password="peer-pass-1234", role=UserRole.ADMIN)
    r = client.post(
        "/api/auth/login",
        json={"username": "peer4", "password": "peer-pass-1234"},
    )
    peer_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.patch(
        f"/admin/api/users/{admin_user.id}",
        headers=peer_headers,
        json={"role": "user"},
    )
    assert r.status_code == 400
    assert "initial admin" in r.json()["detail"].lower()


def test_bulk_skips_initial_admin_with_reason(
    client, admin_user, make_user, session,
):
    """Bulk ops include id=1 with reason='initial_admin' and continue the
    rest of the batch (affected still counts the valid targets)."""
    make_user(username="peer5", password="peer-pass-1234", role=UserRole.ADMIN)
    victim = make_user(username="victim5", password="victim-pass-1234")
    r = client.post(
        "/api/auth/login",
        json={"username": "peer5", "password": "peer-pass-1234"},
    )
    peer_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = client.post(
        "/admin/api/users/bulk",
        headers=peer_headers,
        json={"action": "delete", "user_ids": [admin_user.id, victim.id]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["affected"] == 1
    reasons = {row["user_id"]: row["reason"] for row in body["skipped"]}
    assert reasons[admin_user.id] == "initial_admin"
    # Victim really gone.
    session.expunge_all()
    assert session.get(User, victim.id) is None
    # Initial admin still there.
    assert session.get(User, admin_user.id) is not None
