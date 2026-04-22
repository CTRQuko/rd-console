"""Address book — legacy RustDesk-compatible contract.

Scope: panel-UI-only for now. The routes below authenticate via the standard
panel ``CurrentUser`` dep (JWT from ``/api/auth/login`` OR a Personal Access
Token). Native RustDesk clients hit legacy ``/api/login`` which this
backend does NOT expose yet — a follow-up PR will add that alias.

Contract (kingmo888-compat):

    POST /api/ab/get   → body {"id":"<rustdesk_id>"} (ignored)
                        resp {"updated_at":"2026-04-23T01:33:44","data":"<str>"}
    POST /api/ab       → body {"data":"<stringified JSON>"}
                        resp {"updated_at":"..."}

The ``data`` field is a **stringified** JSON. We store it verbatim — no
parsing, no normalisation — so forward-compat fields (hash, forced_alias,
tag_colors) survive round-trips untouched.

Two routes return a forced 404 (``/api/ab/settings``, ``/api/ab/personal``):
that's the tell Flutter clients use to decide they're talking to a legacy
server and fall back to this blob contract. If they see a 200 on either of
those, they'd expect the newer shared-address-book API which we don't
implement.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..deps import CurrentUser, SessionDep
from ..models.address_book import AddressBook
from ..models.audit_log import AuditAction, AuditLog
from ..security import utcnow_naive

router = APIRouter(prefix="/api/ab", tags=["address-book"])


# ─── Schemas ────────────────────────────────────────────────────────────────


class AbGetRequest(BaseModel):
    """Flutter clients send ``{"id": "<rustdesk_id>"}``. We don't need it
    (scope is per-user, not per-device) but accept + ignore for compat."""

    id: str | None = None


class AbGetResponse(BaseModel):
    updated_at: datetime | None = None
    data: str = ""


class AbPutRequest(BaseModel):
    # Stringified inner JSON. We don't validate the shape here — the client
    # knows its own schema better than we do, and we preserve forward-compat.
    data: str = Field(max_length=10 * 1024 * 1024)  # 10 MiB hard cap


class AbPutResponse(BaseModel):
    updated_at: datetime


# ─── Routes ─────────────────────────────────────────────────────────────────


@router.post("/get", response_model=AbGetResponse)
def ab_get(
    _body: AbGetRequest,
    user: CurrentUser,
    session: SessionDep,
) -> AbGetResponse:
    row = session.get(AddressBook, user.id)
    if row is None:
        # Empty AB = empty string. Flutter copes with "" and {} equally.
        return AbGetResponse(updated_at=None, data="")
    return AbGetResponse(updated_at=row.updated_at, data=row.data)


@router.post("", response_model=AbPutResponse)
def ab_put(
    body: AbPutRequest,
    user: CurrentUser,
    session: SessionDep,
) -> AbPutResponse:
    now = utcnow_naive()
    row = session.get(AddressBook, user.id)
    if row is None:
        row = AddressBook(user_id=user.id, data=body.data, updated_at=now)
    else:
        row.data = body.data
        row.updated_at = now
    session.add(row)

    # Audit payload: size + first 40 chars (useful for "did they clear it?"
    # questions) — never the full blob, which can be many MB.
    preview = body.data[:40].replace("\n", " ")
    action = (
        AuditAction.ADDRESS_BOOK_CLEARED
        if body.data in ("", "{}")
        else AuditAction.ADDRESS_BOOK_UPDATED
    )
    session.add(
        AuditLog(
            action=action,
            actor_user_id=user.id,
            payload=f"bytes={len(body.data)} preview={preview!r}",
        )
    )
    session.commit()
    session.refresh(row)
    return AbPutResponse(updated_at=row.updated_at)


# ─── Flutter-client compatibility probes ────────────────────────────────────
#
# Newer RustDesk clients probe these before deciding which AB API to use.
# Returning 404 here is load-bearing: it's what forces the client into the
# legacy ``/api/ab/get`` + ``/api/ab`` blob mode above. Do NOT implement
# these as 200 without also implementing the full v2 shared-AB contract.


@router.get("/settings", include_in_schema=False)
@router.post("/settings", include_in_schema=False)
def ab_settings_probe() -> None:
    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        "Not implemented — legacy blob AB only",
    )


@router.get("/personal", include_in_schema=False)
@router.post("/personal", include_in_schema=False)
def ab_personal_probe() -> None:
    raise HTTPException(
        status.HTTP_404_NOT_FOUND,
        "Not implemented — legacy blob AB only",
    )
