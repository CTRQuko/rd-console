"""Sync peers from hbbs's own SQLite into our `devices` table.

hbbs (rustdesk/rustdesk-server) is the source of truth for which RustDesk IDs
have ever registered against this relay. It stores them in
``/root/db_v2.sqlite3`` inside its own container — which we mount read-only
into the rd-console container at ``/hbbs-data/``.

We run a background task on app startup that polls that DB every
``RD_HBBS_SYNC_INTERVAL`` seconds, maps each peer row to our Device schema,
and upserts it. The device is considered **online** if hbbs.status == 1.

Why this design (not "let the client POST us heartbeats"):
  - The real RustDesk client only POSTs to the configured API server with a
    specific format that varies across versions. Stubbing that protocol
    ourselves and hoping the shape matches has been fragile.
  - hbbs already does peer discovery robustly — we just mirror what it knows.
  - The sync is one-way (hbbs → rd-console); we never write back.

Failure mode: if the DB file is missing or unreadable the task logs a warning
and retries on the next tick. It never crashes the app.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from .. import db as db_module
from ..config import get_settings
from ..models.device import Device
from ..security import utcnow_naive

log = logging.getLogger("rd_console.hbbs_sync")


def _open_hbbs(db_path: Path) -> sqlite3.Connection:
    """Open the hbbs SQLite file in read-only mode. Using a URI so SQLite
    honours the mode flag — a plain path would default to read-write."""
    uri = f"file:{db_path.resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    # Row factory makes the rest of the code read by column name.
    conn.row_factory = sqlite3.Row
    return conn


def _parse_info(raw: str | None) -> dict[str, Any]:
    """Best-effort parse of the JSON blob in hbbs.peer.info. Returns `{}`
    rather than raising — a malformed row should not block the whole sync."""
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except (TypeError, ValueError):
        return {}


def _extract_ip(info: dict[str, Any]) -> str | None:
    ip = info.get("ip")
    if not isinstance(ip, str) or not ip:
        return None
    # hbbs stores IPv4 as "::ffff:1.2.3.4" — unwrap that common case.
    if ip.startswith("::ffff:"):
        return ip[len("::ffff:") :][:45]
    return ip[:45]


def _sync_once() -> tuple[int, int]:
    """Read every peer row from hbbs and upsert into Device.

    Returns (inserted, updated) counts for logging.
    """
    s = get_settings()
    db_path = Path(s.hbbs_db_path)
    if not db_path.is_file():
        log.debug("hbbs db %s not present — skipping", db_path)
        return (0, 0)

    inserted = 0
    updated = 0
    now = utcnow_naive()

    # Resolve the engine dynamically so test fixtures that patch
    # ``db_module.engine`` pick up their in-memory SQLite.
    with closing(_open_hbbs(db_path)) as hb, Session(db_module.engine) as sess:
        rows = hb.execute(
            "SELECT id, status, note, info, created_at FROM peer"
        ).fetchall()

        for row in rows:
            rustdesk_id = str(row["id"])
            if not rustdesk_id:
                continue
            info = _parse_info(row["info"])
            status = row["status"]
            is_online = status == 1
            ip = _extract_ip(info)
            hostname = info.get("hostname") or info.get("host")
            os_ = info.get("os") or info.get("platform")
            cpu = info.get("cpu")
            version = info.get("version") or info.get("ver")
            # hbbs's created_at is the first time it ever saw this id —
            # useful for our own created_at default but not strictly needed.
            first_seen_raw = row["created_at"]
            try:
                first_seen = datetime.fromisoformat(first_seen_raw) if first_seen_raw else now
            except (TypeError, ValueError):
                first_seen = now

            existing = sess.exec(
                select(Device).where(Device.rustdesk_id == rustdesk_id)
            ).first()

            if existing is None:
                dev = Device(
                    rustdesk_id=rustdesk_id,
                    hostname=(hostname[:128] if isinstance(hostname, str) else None),
                    platform=(os_[:32] if isinstance(os_, str) else None),
                    cpu=(cpu[:128] if isinstance(cpu, str) else None),
                    version=(str(version)[:32] if version else None),
                    last_ip=ip,
                    last_seen_at=now if is_online else None,
                    created_at=first_seen,
                )
                sess.add(dev)
                inserted += 1
            else:
                changed = False
                if hostname and existing.hostname != hostname[:128]:
                    existing.hostname = hostname[:128]
                    changed = True
                if os_ and existing.platform != os_[:32]:
                    existing.platform = os_[:32]
                    changed = True
                if cpu and existing.cpu != cpu[:128]:
                    existing.cpu = cpu[:128]
                    changed = True
                if version and existing.version != str(version)[:32]:
                    existing.version = str(version)[:32]
                    changed = True
                if ip and existing.last_ip != ip:
                    existing.last_ip = ip
                    changed = True
                # last_seen_at: bump when hbbs says the peer is online right
                # now. Leaving it alone when offline means our "online within
                # 5 min" heuristic stays honest for peers that drop off.
                if is_online:
                    existing.last_seen_at = now
                    changed = True
                if changed:
                    sess.add(existing)
                    updated += 1
        sess.commit()

    if inserted or updated:
        log.info("hbbs sync: %d inserted, %d updated", inserted, updated)
    return (inserted, updated)


async def run_sync_loop() -> None:
    """Background loop launched from the FastAPI lifespan. Runs forever
    until the task is cancelled at shutdown."""
    s = get_settings()
    interval = max(5, s.hbbs_sync_interval)
    log.info(
        "hbbs sync loop starting: path=%s interval=%ss",
        s.hbbs_db_path,
        interval,
    )
    while True:
        try:
            # Run the SQLite I/O off the event loop thread.
            await asyncio.to_thread(_sync_once)
        except Exception:
            log.exception("hbbs sync tick failed — continuing")
        await asyncio.sleep(interval)
