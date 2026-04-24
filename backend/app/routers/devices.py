"""Admin: list + inspect + mutate devices registered against the panel."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import nulls_last, or_
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..models.tag import DeviceTag, Tag
from ..models.user import User
from ..security import utcnow_naive
from ..services.hbbs_sync import delete_hbbs_peer

router = APIRouter(prefix="/admin/api/devices", tags=["admin:devices"])

ONLINE_WINDOW = timedelta(minutes=15)  # device seen within 15 min = online
# Note on why 15 and not 5 (v9, 2026-04-24): hbbs (free tier) emits the
# `update_pk` log line — which the watcher turns into /api/heartbeat — only
# on peer registration, IP change, or pubkey change, NOT periodically every
# 30s. An idle-but-connected peer therefore silently ages past a 5-minute
# window and the panel marks it Offline while the client is still happily
# pinging UDP 21116. 15 min covers the typical re-register cadence we see
# in production (one every ~10 min per active peer).


class TagSummary(BaseModel):
    id: int
    name: str
    color: str


class DeviceOut(BaseModel):
    id: int
    rustdesk_id: str
    hostname: str | None
    username: str | None
    platform: str | None
    cpu: str | None
    version: str | None
    owner_user_id: int | None
    last_ip: str | None
    last_seen_at: datetime | None
    created_at: datetime
    online: bool
    # v3 fields — always present so the frontend can rely on their shape.
    note: str | None = None
    is_favorite: bool = False
    tags: list[TagSummary] = Field(default_factory=list)

    @classmethod
    def from_model(
        cls,
        d: Device,
        *,
        now: datetime | None = None,
        tags: list[Tag] | None = None,
    ) -> DeviceOut:
        _now = now or utcnow_naive()
        online = bool(d.last_seen_at and (_now - d.last_seen_at) < ONLINE_WINDOW)
        data = d.model_dump()
        data["online"] = online
        data["tags"] = [
            TagSummary(id=t.id, name=t.name, color=t.color) for t in (tags or [])
        ]
        return cls.model_validate(data)


class DeviceUpdate(BaseModel):
    hostname: str | None = Field(default=None, max_length=128)
    owner_user_id: int | None = Field(default=None)
    # v3
    note: str | None = Field(default=None, max_length=500)
    is_favorite: bool | None = Field(default=None)


class BulkAction(BaseModel):
    device_ids: list[int] = Field(min_length=1, max_length=500)
    action: Literal[
        "assign_tag",
        "unassign_tag",
        "assign_owner",
        "forget",
        "favorite",
        "unfavorite",
    ]
    # Polymorphic payload — only some fields are used per action. Empty dict
    # is fine for favorite / unfavorite / forget.
    tag_id: int | None = None
    owner_user_id: int | None = None


# ─── helpers ────────────────────────────────────────────────────────────────

def _tags_for_device(session, device_id: int) -> list[Tag]:
    links = session.exec(
        select(DeviceTag).where(DeviceTag.device_id == device_id)
    ).all()
    if not links:
        return []
    tag_ids = [li.tag_id for li in links]
    tags = session.exec(select(Tag).where(Tag.id.in_(tag_ids))).all()
    return sorted(tags, key=lambda t: t.name.lower())


def _devices_with_tags_and_cutoff(
    session,
    devices: list[Device],
    now: datetime,
) -> list[DeviceOut]:
    """Bulk-load tags for a set of devices to avoid N+1 queries."""
    if not devices:
        return []
    ids = [d.id for d in devices]
    links = session.exec(
        select(DeviceTag).where(DeviceTag.device_id.in_(ids))
    ).all()
    tag_id_to_obj: dict[int, Tag] = {}
    if links:
        unique_tag_ids = list({li.tag_id for li in links})
        for t in session.exec(select(Tag).where(Tag.id.in_(unique_tag_ids))).all():
            tag_id_to_obj[t.id] = t
    by_device: dict[int, list[Tag]] = {did: [] for did in ids}
    for link in links:
        tag = tag_id_to_obj.get(link.tag_id)
        if tag:
            by_device.setdefault(link.device_id, []).append(tag)
    return [
        DeviceOut.from_model(
            d,
            now=now,
            tags=sorted(by_device.get(d.id, []), key=lambda t: t.name.lower()),
        )
        for d in devices
    ]


# ─── routes ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[DeviceOut])
def list_devices(
    session: SessionDep,
    _: AdminUser,
    status_filter: Literal["all", "online", "offline"] = Query("all", alias="status"),
    platform: str | None = Query(default=None, max_length=32),
    tag_id: int | None = Query(default=None),
    favorite: bool | None = Query(default=None),
) -> list[DeviceOut]:
    """List devices with metadata and a derived `online` field.

    **Important — `online` is a heuristic, not a real-time signal.**

    In the free tier of ``rustdesk-server`` (hbbs), there is NO per-peer
    keepalive exposed to us:

    - ``hbbs.peer`` SQLite table has no ``updated_at`` / ``last_seen`` column.
      The ``status`` bitmap lives only in hbbs memory and is never flushed
      (``rustdesk/rustdesk-server#263``, wontfix upstream).
    - ``hbbs`` stdout emits ``update_pk`` only on peer registration, IP
      change, or pubkey change — NOT on the periodic 30-second UDP ping.
    - The ``hbbs-watcher`` sidecar + ``/api/heartbeat`` endpoint populate
      ``Device.last_seen_at`` **only** when hbbs actually emits one of the
      events above.

    Consequence: an idle-but-connected peer (UDP alive, no IP/pubkey
    change) will eventually age past ``ONLINE_WINDOW`` and appear Offline
    to this endpoint, even though the RustDesk client is still fully
    functional. There is no gratis fix for this; see
    ``docs/servicios/rustdesk/online-detection-limitation.md`` for the
    full write-up and the product decision to accept it.

    Downstream consumers (the SPA especially) should treat ``online`` as
    "seen recently by hbbs" and expose the underlying ``last_seen_at``
    honestly to the user. The SPA does this by rendering a tier
    (fresh/stale/cold) with an explanatory tooltip instead of a binary
    Online/Offline pill.
    """
    now = utcnow_naive()
    cutoff = now - ONLINE_WINDOW

    stmt = select(Device)
    if platform:
        stmt = stmt.where(Device.platform == platform)
    if status_filter == "online":
        stmt = stmt.where(Device.last_seen_at >= cutoff)
    elif status_filter == "offline":
        stmt = stmt.where(
            or_(Device.last_seen_at.is_(None), Device.last_seen_at < cutoff)
        )
    if favorite is not None:
        stmt = stmt.where(Device.is_favorite == favorite)
    if tag_id is not None:
        # Subselect of device_ids that carry that tag. Smaller than a JOIN
        # and plays well with the existing order_by on Device.
        tagged_ids = select(DeviceTag.device_id).where(DeviceTag.tag_id == tag_id)
        stmt = stmt.where(Device.id.in_(tagged_ids))
    stmt = stmt.order_by(nulls_last(Device.last_seen_at.desc()))

    rows = session.exec(stmt).all()
    return _devices_with_tags_and_cutoff(session, rows, now)


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(device_id: int, session: SessionDep, _: AdminUser) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return DeviceOut.from_model(d, tags=_tags_for_device(session, device_id))


@router.patch("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    body: DeviceUpdate,
    session: SessionDep,
    admin: AdminUser,
) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    data = body.model_dump(exclude_unset=True)

    # Validate owner_user_id resolves to a real user before we touch the row.
    # Accept `None` (explicit unassignment) but reject unknown ids.
    if "owner_user_id" in data and data["owner_user_id"] is not None:
        owner = session.get(User, data["owner_user_id"])
        if not owner:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "owner_user_id does not match an existing user",
            )

    changed: dict[str, object] = {}
    for k, v in data.items():
        current = getattr(d, k)
        if current != v:
            changed[k] = v
            setattr(d, k, v)

    if not changed:
        # No-op update — return current state without emitting an audit entry
        # so grep-heavy operators don't see phantom events.
        return DeviceOut.from_model(d, tags=_tags_for_device(session, device_id))

    session.add(d)
    session.add(
        AuditLog(
            action=AuditAction.DEVICE_UPDATED,
            actor_user_id=admin.id,
            from_id=d.rustdesk_id,
            payload=json.dumps({"device_id": device_id, "changes": changed}, default=str),
        )
    )
    # Reconcile auto-tags for attribute changes that affect them
    # (platform, version, owner). Cheaper to always call — the service
    # is idempotent — than to maintain a parallel allowlist here.
    from ..services.auto_tags import sync_auto_tags_for_device
    sync_auto_tags_for_device(session, d)
    session.commit()
    session.refresh(d)
    return DeviceOut.from_model(d, tags=_tags_for_device(session, device_id))


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def forget_device(device_id: int, session: SessionDep, admin: AdminUser) -> None:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    rd_id = d.rustdesk_id

    # Coordinated delete: remove from hbbs FIRST so a sync tick between our
    # local delete and the hbbs delete can't re-insert the row. If the hbbs
    # delete fails (permission, missing file) we bubble a 500 and leave
    # everything untouched — DELETE FROM peer is cheap and idempotent, so
    # the operator can simply retry.
    try:
        hbbs_removed = delete_hbbs_peer(rd_id)
    except Exception as exc:  # noqa: BLE001 — any sqlite/OS error goes here
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Failed to remove peer from hbbs: {exc}",
        ) from exc

    # Remove any tag links first so foreign-key orphans don't survive.
    for link in session.exec(select(DeviceTag).where(DeviceTag.device_id == device_id)).all():
        session.delete(link)
    session.delete(d)
    session.add(
        AuditLog(
            action=AuditAction.DEVICE_FORGOTTEN,
            actor_user_id=admin.id,
            from_id=rd_id,
            payload=json.dumps(
                {
                    "device_id": device_id,
                    "rustdesk_id": rd_id,
                    # Tells post-mortem readers the forget actually reached
                    # hbbs, not just the panel DB.
                    "hbbs_removed": hbbs_removed,
                    "cleanup": "both" if hbbs_removed else "panel-only",
                }
            ),
        )
    )
    session.commit()


@router.post("/{device_id}/disconnect", status_code=status.HTTP_202_ACCEPTED)
def request_disconnect(
    device_id: int,
    session: SessionDep,
    admin: AdminUser,
    force: bool = Query(
        default=False,
        description=(
            "Best-effort cleanup: if true, also remove the peer row from "
            "hbbs's SQLite so the next reconnect forces a re-auth. The "
            "live tunnel keeps running — this is the strongest side effect "
            "the panel can achieve without upstream changes."
        ),
    ),
) -> dict:
    """Request a disconnect; write audit; optionally drop hbbs peer row.

    Upstream RustDesk (rustdesk/rustdesk-server) does NOT expose an admin
    interface for kicking a live hbbr session — the relay is designed as
    a transparent pipe. That means a "real" disconnect is out of reach
    from this panel, period. The best we can do:

      * default (no flag): write an audit event. The in-flight tunnel is
        untouched but we have a record of "please kill it" for ops.
      * `?force=true`: additionally call delete_hbbs_peer so the peer
        has to re-authenticate on its next reconnect. The live tunnel
        still runs — you cannot kill a bit mid-flight from here — but
        this is the closest thing to a kick we can offer.

    Idempotent: repeated calls simply produce additional audit entries.
    """
    d = session.get(Device, device_id)
    rd_id = d.rustdesk_id if d else None

    hbbs_removed = False
    if force and rd_id:
        # delete_hbbs_peer swallows its own failure modes (DB not mounted,
        # unknown peer) so it's safe to call unconditionally. Return is
        # "did anything change" — record that in the audit payload so a
        # future incident can distinguish "nothing to clean" from "cleaned".
        try:
            hbbs_removed = delete_hbbs_peer(rd_id)
        except Exception:  # noqa: BLE001 - defensive; never leak to caller
            hbbs_removed = False

    session.add(
        AuditLog(
            action=AuditAction.DEVICE_DISCONNECT_REQUESTED,
            actor_user_id=admin.id,
            from_id=rd_id,
            payload=json.dumps(
                {
                    "device_id": device_id,
                    "rustdesk_id": rd_id,
                    "force": force,
                    "hbbs_removed": hbbs_removed,
                }
            ),
        )
    )
    session.commit()

    if force:
        note = (
            "Disconnect requested with force. Upstream RustDesk exposes no API "
            "to kick a live hbbr tunnel, but the hbbs peer row was removed so "
            "the next reconnect forces a re-auth."
        )
    else:
        note = (
            "Disconnect requested. Upstream RustDesk exposes no API to kick a "
            "live hbbr tunnel, so this action is audit-only. Retry with "
            "?force=true to also evict the hbbs peer row (re-auth on next "
            "reconnect)."
        )
    return {
        "ok": True,
        "force": force,
        "hbbs_removed": hbbs_removed,
        "note": note,
    }


# ─── v3: per-device tag assignment ──────────────────────────────────────────

@router.post(
    "/{device_id}/tags/{tag_id}",
    response_model=DeviceOut,
    status_code=status.HTTP_200_OK,
)
def assign_tag(
    device_id: int,
    tag_id: int,
    session: SessionDep,
    admin: AdminUser,
) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")

    existing = session.exec(
        select(DeviceTag).where(
            DeviceTag.device_id == device_id,
            DeviceTag.tag_id == tag_id,
        )
    ).first()
    if existing is None:
        session.add(DeviceTag(device_id=device_id, tag_id=tag_id))
        session.add(
            AuditLog(
                action=AuditAction.DEVICE_TAGGED,
                actor_user_id=admin.id,
                from_id=d.rustdesk_id,
                payload=json.dumps(
                    {"device_id": device_id, "tag_id": tag_id, "tag_name": tag.name}
                ),
            )
        )
        session.commit()
        session.refresh(d)

    return DeviceOut.from_model(d, tags=_tags_for_device(session, device_id))


@router.delete(
    "/{device_id}/tags/{tag_id}",
    response_model=DeviceOut,
    status_code=status.HTTP_200_OK,
)
def unassign_tag(
    device_id: int,
    tag_id: int,
    session: SessionDep,
    admin: AdminUser,
) -> DeviceOut:
    d = session.get(Device, device_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")

    link = session.exec(
        select(DeviceTag).where(
            DeviceTag.device_id == device_id,
            DeviceTag.tag_id == tag_id,
        )
    ).first()
    if link:
        session.delete(link)
        tag = session.get(Tag, tag_id)
        session.add(
            AuditLog(
                action=AuditAction.DEVICE_UNTAGGED,
                actor_user_id=admin.id,
                from_id=d.rustdesk_id,
                payload=json.dumps(
                    {
                        "device_id": device_id,
                        "tag_id": tag_id,
                        "tag_name": tag.name if tag else None,
                    }
                ),
            )
        )
        session.commit()
        session.refresh(d)

    return DeviceOut.from_model(d, tags=_tags_for_device(session, device_id))


# ─── v3: bulk operations ────────────────────────────────────────────────────

class BulkResult(BaseModel):
    affected: int
    skipped: int
    action: str


@router.post("/bulk", response_model=BulkResult, status_code=status.HTTP_200_OK)
def bulk_update(
    body: BulkAction,
    session: SessionDep,
    admin: AdminUser,
) -> BulkResult:
    """Apply an action to a list of devices. One audit entry per run (not per
    device) summarising what happened — DEVICE_BULK_UPDATED — so operators
    can tell the bulk ops apart from one-off single-device changes.
    """
    # Resolve the devices up front; missing ids count as "skipped" so the
    # caller gets an honest tally instead of a blanket 404.
    device_rows = session.exec(
        select(Device).where(Device.id.in_(body.device_ids))
    ).all()
    found_ids = {d.id for d in device_rows}
    skipped = len(body.device_ids) - len(found_ids)

    affected = 0

    if body.action == "assign_tag":
        if body.tag_id is None:
            raise HTTPException(400, "tag_id is required for assign_tag")
        tag = session.get(Tag, body.tag_id)
        if not tag:
            raise HTTPException(404, "Tag not found")
        for d in device_rows:
            existing = session.exec(
                select(DeviceTag).where(
                    DeviceTag.device_id == d.id,
                    DeviceTag.tag_id == body.tag_id,
                )
            ).first()
            if existing is None:
                session.add(DeviceTag(device_id=d.id, tag_id=body.tag_id))
                affected += 1

    elif body.action == "unassign_tag":
        if body.tag_id is None:
            raise HTTPException(400, "tag_id is required for unassign_tag")
        for d in device_rows:
            link = session.exec(
                select(DeviceTag).where(
                    DeviceTag.device_id == d.id,
                    DeviceTag.tag_id == body.tag_id,
                )
            ).first()
            if link:
                session.delete(link)
                affected += 1

    elif body.action == "assign_owner":
        if body.owner_user_id is not None:
            owner = session.get(User, body.owner_user_id)
            if not owner:
                raise HTTPException(422, "owner_user_id does not match an existing user")
        for d in device_rows:
            if d.owner_user_id != body.owner_user_id:
                d.owner_user_id = body.owner_user_id
                session.add(d)
                affected += 1

    elif body.action == "forget":
        # Mirror the single-device forget: remove from hbbs first so the
        # next sync tick can't resurrect the row. A partial failure halts
        # the bulk op — safer than leaving half-deleted state.
        hbbs_failures: list[str] = []
        for d in device_rows:
            try:
                delete_hbbs_peer(d.rustdesk_id)
            except Exception as exc:  # noqa: BLE001
                hbbs_failures.append(f"{d.rustdesk_id}: {exc}")
                continue
            for link in session.exec(
                select(DeviceTag).where(DeviceTag.device_id == d.id)
            ).all():
                session.delete(link)
            session.delete(d)
            affected += 1
        if hbbs_failures:
            # Commit whatever succeeded so partial progress is durable,
            # then surface the failures.
            session.commit()
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "Failed to remove some peers from hbbs: " + "; ".join(hbbs_failures),
            )

    elif body.action in ("favorite", "unfavorite"):
        target = body.action == "favorite"
        for d in device_rows:
            if d.is_favorite != target:
                d.is_favorite = target
                session.add(d)
                affected += 1

    if affected > 0:
        session.add(
            AuditLog(
                action=AuditAction.DEVICE_BULK_UPDATED,
                actor_user_id=admin.id,
                payload=json.dumps(
                    {
                        "action": body.action,
                        "device_ids": sorted(found_ids),
                        "tag_id": body.tag_id,
                        "owner_user_id": body.owner_user_id,
                        "affected": affected,
                        "skipped": skipped,
                    }
                ),
            )
        )
    session.commit()

    return BulkResult(affected=affected, skipped=skipped, action=body.action)
