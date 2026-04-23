"""Auto-generate tags from device attributes.

Drives the v6 tags re-design: the Tags page is gone, tags now live as
device metadata that populates itself. Callers hook into the points
where a device's "shape" is known to change:

  * hbbs_sync — after upserting metadata from the hbbs peer table.
  * routers/rustdesk /api/sysinfo — after the client's own upsert.
  * routers/devices PATCH — after an owner change.

The function is idempotent: re-running against the same device adds
nothing new, removes nothing still valid, and only touches the DB when
an attribute actually changed.

Tag naming:
  * platform   → "Windows", "Linux", "macOS", "Android" (as-is)
  * version    → "v1.2" (major.minor; hides noise of patch bumps)
  * owner      → the owning user's username, prefixed "owner:<name>"

Colours are deterministic per bucket so the UI renders consistent
chips without needing admin curation.
"""

from __future__ import annotations

import re

from sqlmodel import Session, select

from ..models.device import Device
from ..models.tag import DeviceTag, Tag
from ..models.user import User

# Source -> default colour when creating an auto-tag. Colours picked to
# feel distinct from what an admin would hand-pick (platforms are neutral
# zinc; owner is violet; version is amber). Matches TAG_COLORS.
_COLOUR_BY_SOURCE = {
    "platform": "zinc",
    "version": "amber",
    "owner": "violet",
}

_VERSION_RE = re.compile(r"^\s*(\d+)\.(\d+)")


def _version_bucket(version: str | None) -> str | None:
    """Collapse a full version string into a `vMAJOR.MINOR` bucket so
    patch bumps don't churn tags. `1.2.3-beta` and `1.2.47` both
    collapse to `v1.2`."""
    if not version:
        return None
    m = _VERSION_RE.match(version)
    if not m:
        return None
    return f"v{m.group(1)}.{m.group(2)}"


def _desired_tags_for_device(session: Session, device: Device) -> list[tuple[str, str]]:
    """Return the (source, name) pairs this device should currently
    carry as auto-tags. Unchanged shapes produce unchanged lists, so
    downstream diffing stays cheap."""
    out: list[tuple[str, str]] = []
    if device.platform:
        out.append(("platform", device.platform))
    bucket = _version_bucket(device.version)
    if bucket:
        out.append(("version", bucket))
    if device.owner_user_id is not None:
        owner = session.get(User, device.owner_user_id)
        if owner is not None:
            out.append(("owner", owner.username))
    return out


def _ensure_tag(session: Session, *, source: str, name: str) -> Tag:
    """Find-or-create an auto-tag with the exact (source, name) pair.

    We key on `(auto=True, auto_source=source, name=name)` rather than
    just `name` — an admin-created "Windows" tag and an auto "Windows"
    tag coexist without interfering. The router-side case-insensitive
    uniqueness doesn't apply to auto-tags (they bypass that router).
    """
    hit = session.exec(
        select(Tag).where(
            Tag.auto == True,  # noqa: E712
            Tag.auto_source == source,
            Tag.name == name,
        )
    ).first()
    if hit is not None:
        return hit
    tag = Tag(
        name=name,
        color=_COLOUR_BY_SOURCE.get(source, "zinc"),
        auto=True,
        auto_source=source,
    )
    session.add(tag)
    session.flush()
    return tag


def sync_auto_tags_for_device(session: Session, device: Device) -> None:
    """Reconcile this device's auto-tag attachments with the current
    shape of the device. Idempotent — safe to call on every sync tick
    or PATCH, even when nothing has changed.

    Never commits. The caller's transaction owns the commit boundary so
    we don't split a logical unit (hbbs_sync updates metadata AND
    auto-tags as one write, for example).
    """
    if device.id is None:
        # Pre-insert devices — caller should flush first, not our job.
        return

    desired = _desired_tags_for_device(session, device)
    desired_tag_ids: set[int] = set()
    for source, name in desired:
        tag = _ensure_tag(session, source=source, name=name)
        if tag.id is not None:
            desired_tag_ids.add(tag.id)

    # Existing auto-tag attachments for this device. Admin-assigned
    # tags (auto=False) are left strictly alone — syncing them would
    # violate the contract "auto-tags do not clobber manual tags".
    existing_links = session.exec(
        select(DeviceTag, Tag)
        .where(DeviceTag.device_id == device.id)
        .where(DeviceTag.tag_id == Tag.id)
        .where(Tag.auto == True)  # noqa: E712
    ).all()
    existing_tag_ids = {t.id for (_, t) in existing_links if t.id is not None}

    # Add missing desired links.
    for tid in desired_tag_ids - existing_tag_ids:
        session.add(DeviceTag(device_id=device.id, tag_id=tid))

    # Remove auto-tag links that no longer apply (e.g. owner changed).
    for link, tag in existing_links:
        if tag.id is None:
            continue
        if tag.id not in desired_tag_ids:
            session.delete(link)
