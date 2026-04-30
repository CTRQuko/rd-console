"""Address-book v2 — Group + Contact CRUD.

Coexists with the legacy /api/ab blob endpoints (those still serve
the kingmo888 sync protocol that the RustDesk clients use). The v2
endpoints power the editor in the redesigned panel.

Every group is owned by a single user. Cross-user sharing isn't in
scope yet; a future feature ("share group with operator X") would
add an `AbGroupShare` join table.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..deps import CurrentUser, SessionDep
from ..models.address_book import AddressBook
from ..models.address_book_v2 import AbContact, AbGroup
from ..security import utcnow_naive

log = logging.getLogger("rd_console.ab_v2")
router = APIRouter(prefix="/api/ab/v2", tags=["address-book:v2"])


# ─── Schemas ────────────────────────────────────────────────────────────────


class GroupOut(BaseModel):
    id: int
    name: str
    color: str
    note: str
    contact_count: int
    created_at: str


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str = Field(default="blue", max_length=32)
    note: str = Field(default="", max_length=500)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    color: str | None = Field(default=None, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class ContactOut(BaseModel):
    id: int
    group_id: int
    rd_id: str
    alias: str
    username: str
    platform: str
    note: str
    tags: list[str]
    created_at: str


class ContactCreate(BaseModel):
    rd_id: str = Field(min_length=1, max_length=32)
    alias: str = Field(default="", max_length=128)
    username: str = Field(default="", max_length=128)
    platform: str = Field(default="", max_length=64)
    note: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=32)


class ContactPatch(BaseModel):
    alias: str | None = Field(default=None, max_length=128)
    username: str | None = Field(default=None, max_length=128)
    platform: str | None = Field(default=None, max_length=64)
    note: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = Field(default=None, max_length=32)


class ImportResult(BaseModel):
    imported: bool
    groups_created: int
    contacts_created: int


# ─── Helpers ────────────────────────────────────────────────────────────────


def _decode_tags(raw: str) -> list[str]:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(t) for t in parsed if isinstance(t, str)]
    except (ValueError, TypeError):
        pass
    return []


def _group_to_out(session: Session, g: AbGroup) -> GroupOut:
    count = len(
        session.exec(select(AbContact).where(AbContact.group_id == g.id)).all()
    )
    return GroupOut(
        id=g.id,  # type: ignore[arg-type]
        name=g.name,
        color=g.color,
        note=g.note,
        contact_count=count,
        created_at=g.created_at.isoformat(),
    )


def _contact_to_out(c: AbContact) -> ContactOut:
    return ContactOut(
        id=c.id,  # type: ignore[arg-type]
        group_id=c.group_id,
        rd_id=c.rd_id,
        alias=c.alias,
        username=c.username,
        platform=c.platform,
        note=c.note,
        tags=_decode_tags(c.tags),
        created_at=c.created_at.isoformat(),
    )


def _own_group_or_404(session: Session, user_id: int, group_id: int) -> AbGroup:
    g = session.get(AbGroup, group_id)
    if g is None or g.owner_user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return g


def _import_blob_if_empty(session: Session, user_id: int) -> ImportResult:
    """One-shot: if the user has zero v2 groups but a v1 blob exists,
    parse the kingmo888 shape into Group/Contact rows. Idempotent —
    a second call with v2 rows already present returns imported=False
    without touching anything.
    """
    existing = session.exec(
        select(AbGroup).where(AbGroup.owner_user_id == user_id).limit(1)
    ).first()
    if existing is not None:
        return ImportResult(imported=False, groups_created=0, contacts_created=0)

    blob_row = session.get(AddressBook, user_id)
    if blob_row is None or not blob_row.data:
        return ImportResult(imported=False, groups_created=0, contacts_created=0)

    try:
        blob = json.loads(blob_row.data)
    except (ValueError, TypeError):
        return ImportResult(imported=False, groups_created=0, contacts_created=0)

    # kingmo888 shape: top-level "peers" + "tags" arrays. We bucket
    # peers by their first tag (or "Sin etiqueta"). Mirrors the
    # read-only adapter in the legacy AddressBook.tsx.
    peers = blob.get("peers", []) if isinstance(blob, dict) else []
    if not isinstance(peers, list):
        return ImportResult(imported=False, groups_created=0, contacts_created=0)

    groups_by_name: dict[str, AbGroup] = {}
    groups_created = 0
    contacts_created = 0

    for peer in peers:
        if not isinstance(peer, dict):
            continue
        tags = peer.get("tags") or []
        if not isinstance(tags, list):
            tags = []
        primary = next((t for t in tags if isinstance(t, str)), "Sin etiqueta")

        g = groups_by_name.get(primary)
        if g is None:
            g = AbGroup(owner_user_id=user_id, name=primary, color="blue", note="")
            session.add(g)
            session.flush()  # populate g.id
            groups_by_name[primary] = g
            groups_created += 1

        c = AbContact(
            group_id=g.id,  # type: ignore[arg-type]
            rd_id=str(peer.get("id", "")),
            alias=str(peer.get("alias", "") or peer.get("hostname", "")),
            username=str(peer.get("username", "")),
            platform=str(peer.get("platform", "")),
            note=str(peer.get("note", "")),
            tags=json.dumps([t for t in tags if isinstance(t, str)]),
        )
        session.add(c)
        contacts_created += 1

    session.commit()
    return ImportResult(
        imported=True,
        groups_created=groups_created,
        contacts_created=contacts_created,
    )


# ─── Routes ─────────────────────────────────────────────────────────────────


@router.get("/groups", response_model=list[GroupOut])
def list_groups(user: CurrentUser, session: SessionDep) -> list[GroupOut]:
    """Return every group owned by the caller. Auto-migrates the v1
    blob on first call (idempotent — won't double-import)."""
    _import_blob_if_empty(session, user.id)
    rows = session.exec(
        select(AbGroup)
        .where(AbGroup.owner_user_id == user.id)
        .order_by(AbGroup.name.asc())  # type: ignore[attr-defined]
    ).all()
    return [_group_to_out(session, g) for g in rows]


@router.post(
    "/groups",
    response_model=GroupOut,
    status_code=status.HTTP_201_CREATED,
)
def create_group(
    body: GroupCreate, user: CurrentUser, session: SessionDep
) -> GroupOut:
    g = AbGroup(
        owner_user_id=user.id,
        name=body.name,
        color=body.color,
        note=body.note,
    )
    session.add(g)
    session.commit()
    session.refresh(g)
    return _group_to_out(session, g)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(
    group_id: int,
    body: GroupPatch,
    user: CurrentUser,
    session: SessionDep,
) -> GroupOut:
    g = _own_group_or_404(session, user.id, group_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        g.name = data["name"]
    if "color" in data:
        g.color = data["color"]
    if "note" in data:
        g.note = data["note"]
    g.updated_at = utcnow_naive()
    session.add(g)
    session.commit()
    session.refresh(g)
    return _group_to_out(session, g)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int, user: CurrentUser, session: SessionDep
) -> None:
    g = _own_group_or_404(session, user.id, group_id)
    # Cascade: delete contacts first.
    contacts = session.exec(
        select(AbContact).where(AbContact.group_id == group_id)
    ).all()
    for c in contacts:
        session.delete(c)
    session.delete(g)
    session.commit()


@router.get(
    "/groups/{group_id}/contacts",
    response_model=list[ContactOut],
)
def list_contacts(
    group_id: int, user: CurrentUser, session: SessionDep
) -> list[ContactOut]:
    _own_group_or_404(session, user.id, group_id)
    rows = session.exec(
        select(AbContact)
        .where(AbContact.group_id == group_id)
        .order_by(AbContact.alias.asc(), AbContact.rd_id.asc())  # type: ignore[attr-defined]
    ).all()
    return [_contact_to_out(c) for c in rows]


@router.post(
    "/groups/{group_id}/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
)
def create_contact(
    group_id: int,
    body: ContactCreate,
    user: CurrentUser,
    session: SessionDep,
) -> ContactOut:
    _own_group_or_404(session, user.id, group_id)
    c = AbContact(
        group_id=group_id,
        rd_id=body.rd_id,
        alias=body.alias,
        username=body.username,
        platform=body.platform,
        note=body.note,
        tags=json.dumps(body.tags),
    )
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contact_to_out(c)


@router.patch("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    body: ContactPatch,
    user: CurrentUser,
    session: SessionDep,
) -> ContactOut:
    c = session.get(AbContact, contact_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    g = session.get(AbGroup, c.group_id)
    if g is None or g.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")

    data = body.model_dump(exclude_unset=True)
    for field in ("alias", "username", "platform", "note"):
        if field in data:
            setattr(c, field, data[field])
    if "tags" in data and data["tags"] is not None:
        c.tags = json.dumps(data["tags"])
    c.updated_at = utcnow_naive()
    session.add(c)
    session.commit()
    session.refresh(c)
    return _contact_to_out(c)


@router.delete(
    "/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_contact(
    contact_id: int, user: CurrentUser, session: SessionDep
) -> None:
    c = session.get(AbContact, contact_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    g = session.get(AbGroup, c.group_id)
    if g is None or g.owner_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    session.delete(c)
    session.commit()


@router.post("/import-blob", response_model=ImportResult)
def import_blob(user: CurrentUser, session: SessionDep) -> ImportResult:
    """Force a re-import from the v1 blob. No-op if v2 rows already
    exist for the user — operators who want to start fresh should
    delete their groups first."""
    return _import_blob_if_empty(session, user.id)
