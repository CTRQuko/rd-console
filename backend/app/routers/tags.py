"""Admin: manage the tag vocabulary.

Tags are short labels that admins attach to devices (see
`POST /admin/api/devices/{id}/tags/{tag_id}` in routers/devices.py).

Names are case-insensitive unique — enforced here rather than with a
SQLite functional index so the 409 surface lives next to the router code
that owns it.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.tag import TAG_COLORS, DeviceTag, Tag

router = APIRouter(prefix="/admin/api/tags", tags=["admin:tags"])


class TagOut(BaseModel):
    id: int
    name: str
    color: str
    created_at: datetime
    device_count: int
    auto: bool = False
    auto_source: str | None = None


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_\- .]+$")
    color: str = Field(default="blue", max_length=16)


def _tag_with_count(session, tag: Tag) -> TagOut:
    """Attach a device_count to a Tag for the outbound response."""
    count = session.exec(
        select(func.count()).select_from(DeviceTag).where(DeviceTag.tag_id == tag.id)
    ).one()
    return TagOut(
        id=tag.id,
        name=tag.name,
        color=tag.color,
        created_at=tag.created_at,
        device_count=int(count),
        auto=tag.auto,
        auto_source=tag.auto_source,
    )


@router.get("", response_model=list[TagOut])
def list_tags(session: SessionDep, _: AdminUser) -> list[TagOut]:
    rows = session.exec(select(Tag).order_by(Tag.name)).all()
    return [_tag_with_count(session, t) for t in rows]


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(body: TagCreate, session: SessionDep, admin: AdminUser) -> TagOut:
    if body.color not in TAG_COLORS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"color must be one of {', '.join(TAG_COLORS)}",
        )

    # Case-insensitive uniqueness — we store the name as the user typed it
    # but reject anything that collides on lower(). Avoids "office" vs
    # "Office" confusion in the filter dropdown.
    existing = session.exec(
        select(Tag).where(func.lower(Tag.name) == body.name.lower())
    ).first()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Tag '{existing.name}' already exists",
        )

    tag = Tag(name=body.name, color=body.color)
    session.add(tag)
    session.add(
        AuditLog(
            action=AuditAction.TAG_CREATED,
            actor_user_id=admin.id,
            payload=f"name={body.name} color={body.color}",
        )
    )
    session.commit()
    session.refresh(tag)
    return _tag_with_count(session, tag)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, session: SessionDep, admin: AdminUser) -> None:
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")

    # Auto-tags are derived from device attributes by services/auto_tags.
    # Deleting one would just have the next sync/heartbeat re-create it,
    # so we refuse up front — keeps the audit trail clean and the error
    # explanation obvious.
    if tag.auto:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Auto-generated tags cannot be deleted — change the device's "
            "platform, version, or owner instead.",
        )

    # Remove all device<->tag links first (no ON DELETE CASCADE in SQLite
    # without PRAGMA foreign_keys=ON, which we don't enforce).
    links = session.exec(select(DeviceTag).where(DeviceTag.tag_id == tag_id)).all()
    for link in links:
        session.delete(link)
    session.delete(tag)

    session.add(
        AuditLog(
            action=AuditAction.TAG_DELETED,
            actor_user_id=admin.id,
            payload=f"tag_id={tag_id} name={tag.name} unlinked={len(links)}",
        )
    )
    session.commit()
