"""RustDesk client protocol — stubs for the endpoints that the official
RustDesk client hits against the configured "API server".

These need to be fleshed out in F4 (frontend integration / client testing).
Endpoint names/shapes mirror what kingmo888/rustdesk-api-server exposes, since
that's what the client speaks. Everything returns minimal valid responses for
now so the client doesn't explode on connect.

All endpoints here are gated by `require_client_secret` — when the
`RD_CLIENT_SHARED_SECRET` env var is configured, clients must send it in the
`X-RD-Secret` header. When unset, endpoints remain open (opt-in hardening,
backward compatible with existing deployments).
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from ..config import get_settings
from ..deps import ClientSecretDep, CurrentUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..models.user import User, UserRole
from ..security import (
    create_access_token,
    decode_access_token,
    hash_password,
    needs_rehash,
    utcnow_naive,
    verify_password,
)

router = APIRouter(prefix="/api", tags=["rustdesk-client"])


class HeartbeatPayload(BaseModel):
    id: str  # RustDesk ID
    uuid: str | None = None
    ver: int | None = None
    # additional fields are ignored for now


class SysinfoPayload(BaseModel):
    id: str
    hostname: str | None = None
    username: str | None = None
    os: str | None = None
    cpu: str | None = None
    version: str | None = None
    uuid: str | None = None


def _truncated_payload(payload: dict) -> str:
    """JSON-serialise and hard-cap the payload for persistence."""
    max_bytes = get_settings().max_audit_payload_bytes
    try:
        raw = json.dumps(payload, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        raw = repr(payload)
    if len(raw) > max_bytes:
        raw = raw[: max_bytes - 3] + "..."
    return raw


def _client_ip(request: Request) -> str | None:
    # In Docker/behind-proxy we expose X-Forwarded-For; trust it only if a
    # reverse proxy is in front (operator's responsibility). Fall back to the
    # direct socket.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()[:45] or None
    if request.client:
        return request.client.host[:45]
    return None


@router.post("/heartbeat")
def heartbeat(
    body: HeartbeatPayload,
    request: Request,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    """Update last_seen_at on heartbeat. Creates the device row if unknown.

    Uses an upsert to avoid the insert-insert race when two heartbeats for the
    same brand-new rustdesk_id hit the server concurrently.
    """
    now = utcnow_naive()
    ip = _client_ip(request)

    device = session.exec(
        select(Device).where(Device.rustdesk_id == body.id)
    ).first()
    if device is None:
        device = Device(rustdesk_id=body.id, last_seen_at=now, last_ip=ip)
        session.add(device)
        try:
            session.commit()
        except Exception:
            # Race: another worker inserted the same rustdesk_id between the
            # SELECT and INSERT. Roll back and re-read.
            session.rollback()
            device = session.exec(
                select(Device).where(Device.rustdesk_id == body.id)
            ).first()
            if device is None:
                # Truly unexpected — surface as a generic OK to avoid leaking.
                return {"ok": True}
    device.last_seen_at = now
    if ip:
        device.last_ip = ip
    session.add(device)
    session.commit()
    return {"ok": True}


@router.post("/sysinfo")
def sysinfo(
    body: SysinfoPayload,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    from ..services.auto_tags import sync_auto_tags_for_device

    device = session.exec(select(Device).where(Device.rustdesk_id == body.id)).first()
    is_new = device is None
    # Snapshot the three identity fields BEFORE overwrite so we can detect
    # drift and write a single audit row covering all changes. Only the
    # triple that operators care about (hostname / platform / version) is
    # tracked — cpu flips too noisily across reboots on some distros, and
    # username is per-session noise.
    before: dict[str, str | None] = (
        {}
        if is_new
        else {
            "hostname": device.hostname,
            "platform": device.platform,
            "version": device.version,
        }
    )
    if device is None:
        device = Device(rustdesk_id=body.id)
    device.hostname = body.hostname or device.hostname
    device.username = body.username or device.username
    device.platform = body.os or device.platform
    device.cpu = body.cpu or device.cpu
    device.version = body.version or device.version
    device.last_seen_at = utcnow_naive()
    session.add(device)
    # Flush so a brand-new device gets an id before tag reconciliation.
    session.flush()
    sync_auto_tags_for_device(session, device)

    # Diff AFTER auto-tags so the audit payload reflects what actually got
    # committed. Skipped for brand-new peers: the first sysinfo is "first
    # seen", and the heartbeat side already records the CONNECT event, so
    # a DEVICE_UPDATED there would be redundant.
    if not is_new:
        after = {
            "hostname": device.hostname,
            "platform": device.platform,
            "version": device.version,
        }
        changed = [k for k in ("hostname", "platform", "version") if before[k] != after[k]]
        if changed:
            session.add(
                AuditLog(
                    action=AuditAction.DEVICE_UPDATED,
                    from_id=body.id[:32],
                    payload=json.dumps(
                        {
                            "rustdesk_id": body.id,
                            "changed": changed,
                            "before": {k: before[k] for k in changed},
                            "after": {k: after[k] for k in changed},
                        },
                        default=str,
                    ),
                )
            )
    session.commit()
    return {"ok": True}


_audit_log = __import__("logging").getLogger("rd_console.audit")


def _audit_conn_from_id(payload: dict) -> str | None:
    """Extract the from-peer id. Upstream Flutter packs it as peer[0];
    older / homebuilt clients use a flat `from_id` key."""
    peer = payload.get("peer")
    if isinstance(peer, list) and peer:
        candidate = peer[0]
        if isinstance(candidate, str) and candidate:
            return candidate[:32]
    # Back-compat flat keys. `id` used to be mistreated as "from" — the
    # upstream contract says `id` is the receiver. Never fall back to
    # payload["id"] here to avoid swapping from/to on modern clients.
    flat = payload.get("from_id")
    if isinstance(flat, str) and flat:
        return flat[:32]
    return None


def _audit_conn_to_id(payload: dict) -> str | None:
    """Extract the receiver peer id. Upstream calls it `id`; older clients
    use `to_id` / `peer_id`."""
    for key in ("id", "to_id", "peer_id"):
        val = payload.get(key)
        if isinstance(val, str) and val:
            return val[:32]
    return None


# action → AuditAction mapping. Anything we don't recognise falls back to
# CONNECT so an unexpected client doesn't silently swallow events.
_ACTION_TO_AUDIT = {
    "new": AuditAction.CONNECT,
    "close": AuditAction.DISCONNECT,
}


@router.post("/audit/conn")
def audit_conn(
    payload: dict,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    """Connection start/stop events from the RustDesk client.

    Upstream contract (AuditConnForm in lejianwen/rustdesk-api):

        {
          "action": "new" | "close" | "",
          "id": "<receiver peer id>",
          "peer": ["<from peer id>", "<from peer name>"],
          "ip": "<client ip>",
          "session_id": <float>,
          "conn_id": <int>,
          "type": <int>,        # 0=screen, 1=file, 2=port-forward, 3=tcp-tunnel
          "uuid": "<client uuid>"
        }

    We translate:
      * action="new"   → AuditAction.CONNECT
      * action="close" → AuditAction.DISCONNECT
      * anything else  → AuditAction.CONNECT (back-compat: older clients and
        custom forks don't always populate `action`; "something useful" beats
        "nothing").

    Raw payload logging is gated behind `RD_DEBUG_RAW_AUDIT_CONN=1` for
    field investigations when a new client build appears.
    """
    if get_settings().debug_raw_audit_conn:
        _audit_log.info("audit_conn raw: %s", payload)

    raw_action = payload.get("action")
    action_key = raw_action.lower() if isinstance(raw_action, str) else ""
    audit_action = _ACTION_TO_AUDIT.get(action_key, AuditAction.CONNECT)

    session.add(
        AuditLog(
            action=audit_action,
            from_id=_audit_conn_from_id(payload),
            to_id=_audit_conn_to_id(payload),
            ip=str(payload.get("ip") or "")[:45] or None,
            uuid=str(payload.get("uuid") or "")[:64] or None,
            payload=_truncated_payload(payload),
        )
    )
    session.commit()
    return {"ok": True}


# ─── Legacy RustDesk client auth aliases ──────────────────────────────────────
#
# Native RustDesk (Flutter) clients call POST /api/login / /api/currentUser /
# /api/logout to sign the user in before syncing the address book. The contract
# mirrors kingmo888/rustdesk-api-server so the client behaves identically.
#
# Intentionally NOT gated by ClientSecretDep: the Flutter client never sends
# X-RD-Secret on the auth flow, and gating it there would lock real users out.
# The JWT minted here has the same shape as /api/auth/login (sub = user.id as
# string, extra role claim), so the already-mounted /api/ab endpoints accept
# it via the existing CurrentUser dep without any additional wiring.


class LegacyLoginRequest(BaseModel):
    # The Flutter client sends username/password plus a grab-bag of device
    # fields we don't care about. Accept them silently so Pydantic doesn't
    # 422 us on a new client build.
    model_config = ConfigDict(extra="ignore")

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    id: str | None = None  # client's RustDesk ID
    uuid: str | None = None
    autoLogin: bool | None = None  # noqa: N815 - wire format
    type: str | None = None
    deviceInfo: dict | None = None  # noqa: N815 - wire format


def _user_payload(user: User) -> dict:
    """Shape the `user` object that kingmo888 returns. We include a superset
    of fields observed across Flutter client versions so newer builds that
    read e.g. `is_admin` don't crash on a missing key."""
    return {
        "id": user.id,
        "name": user.username,
        "email": user.email or "",
        "note": "",
        "status": 1 if user.is_active else 0,
        "is_admin": user.role == UserRole.ADMIN,
        "grp": "",
    }


@router.post("/login")
def legacy_login(body: LegacyLoginRequest, session: SessionDep) -> dict:
    """kingmo888-compatible login for the native RustDesk client."""
    user = session.exec(select(User).where(User.username == body.username)).first()
    password_ok = bool(user) and verify_password(body.password, user.password_hash)  # type: ignore[union-attr]
    if not user or not user.is_active or not password_ok:
        session.add(
            AuditLog(
                action=AuditAction.LOGIN_FAILED,
                payload=f"legacy username={body.username[:64]}",
            )
        )
        session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)

    user.last_login_at = utcnow_naive()
    session.add(user)
    session.add(
        AuditLog(
            action=AuditAction.LOGIN,
            actor_user_id=user.id,
            payload="legacy",
        )
    )
    session.commit()
    session.refresh(user)

    token = create_access_token(
        subject=user.id, extra_claims={"role": user.role.value}
    )
    return {
        "access_token": token,
        "type": "access_token",
        "tfa_type": "",
        "secret": "",
        "user": _user_payload(user),
    }


@router.post("/currentUser")
def legacy_current_user(
    user: CurrentUser,
    authorization: str | None = Header(default=None),
) -> dict:
    """Probe the current session. The client uses this to validate its
    cached token on startup; if it fails the client drops the AB and asks
    for a fresh login.

    Echoes `access_token` + `type` back verbatim to match kingmo888's
    contract — the Flutter client uses this response to refresh its
    cached token triple (access_token, type, name) on every probe.
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    return {
        "access_token": token,
        "type": "access_token",
        "name": user.username,
        # Extra fields are additive — kingmo888 only returns the three above,
        # but the Flutter client reads via dict.get so unknown keys are fine
        # and let the panel UI share this handler later if needed.
        "id": user.id,
        "email": user.email or "",
        "note": "",
        "status": 1 if user.is_active else 0,
        "is_admin": user.role == UserRole.ADMIN,
        "grp": "",
    }


class LegacyLogoutRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    uuid: str | None = None


@router.post("/logout")
def legacy_logout(  # noqa: ARG001 - body kept for wire compat
    body: LegacyLogoutRequest,
    session: SessionDep,
    authorization: str | None = Header(default=None),
) -> dict:
    """Revoke the Flutter client's JWT and return kingmo888-compatible ack.

    As of v8 we do have a denylist — same `jwt_revocations` table the panel
    `/api/auth/logout` writes to. The response still has to be `{code: 1}`
    verbatim because the Flutter client branches on that key and anything
    else hangs its sign-out flow.

    Auth header is optional: the client sometimes calls logout after the
    token was already dropped, and we must not 401 there (would leave the
    client stuck in a retry loop). Missing / malformed token → no-op, still
    returns `{code: 1}`.
    """
    from datetime import datetime

    from ..models.jwt_revocation import JwtRevocation

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        claims = decode_access_token(token)
        if claims and "jti" in claims and "exp" in claims and "sub" in claims:
            try:
                user_id = int(claims["sub"])
            except (ValueError, TypeError):
                user_id = None
            jti = claims["jti"]
            if user_id is not None and session.get(JwtRevocation, jti) is None:
                session.add(
                    JwtRevocation(
                        jti=jti,
                        user_id=user_id,
                        expires_at=datetime.utcfromtimestamp(int(claims["exp"])),
                    )
                )
                session.commit()
    return {"code": 1}


@router.post("/audit/file")
def audit_file(
    payload: dict,
    session: SessionDep,
    _: ClientSecretDep,
) -> dict:
    session.add(
        AuditLog(
            action=AuditAction.FILE_TRANSFER,
            from_id=str(payload.get("from_id") or "")[:32] or None,
            to_id=str(payload.get("to_id") or "")[:32] or None,
            payload=_truncated_payload(payload),
        )
    )
    session.commit()
    return {"ok": True}
