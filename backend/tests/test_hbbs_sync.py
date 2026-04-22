"""hbbs -> rd-console device sync tests.

The sync reads the peer table from hbbs's own SQLite (mounted read-only in
production at /hbbs-data/db_v2.sqlite3) and upserts into our Device table.
Tests spin up a throwaway SQLite with the exact hbbs schema, point the
setting at it, and invoke the sync function synchronously.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from sqlmodel import select

from app.config import get_settings
from app.models.device import Device
from app.services.hbbs_sync import _parse_info, _sync_once

HBBS_SCHEMA = """
CREATE TABLE peer (
    guid blob primary key not null,
    id varchar(100) not null,
    uuid blob not null,
    pk blob not null,
    created_at datetime not null default(current_timestamp),
    user blob,
    status tinyint,
    note varchar(300),
    info text not null
) without rowid;
"""


@pytest.fixture()
def hbbs_db(tmp_path: Path, monkeypatch) -> Path:
    """Create an empty hbbs-shaped SQLite and re-point the settings at it."""
    p = tmp_path / "db_v2.sqlite3"
    conn = sqlite3.connect(p)
    conn.executescript(HBBS_SCHEMA)
    conn.commit()
    conn.close()
    # lru_cache already cached the settings — poke the attribute directly.
    s = get_settings()
    monkeypatch.setattr(s, "hbbs_db_path", p)
    return p


def _seed_peer(
    db: Path,
    *,
    rd_id: str,
    status: int,
    info: dict,
    guid: bytes = b"\\x01",
    uuid: bytes = b"\\x02",
    pk: bytes = b"\\x03",
) -> None:
    import json as _json

    conn = sqlite3.connect(db)
    # INSERT OR REPLACE keyed on the unique index on id handles re-seed.
    conn.execute(
        "INSERT OR REPLACE INTO peer (guid, id, uuid, pk, status, info)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (guid, rd_id, uuid, pk, status, _json.dumps(info)),
    )
    conn.commit()
    conn.close()


def test_parse_info_happy_path():
    assert _parse_info('{"ip":"::ffff:10.0.0.1","hostname":"foo"}') == {
        "ip": "::ffff:10.0.0.1",
        "hostname": "foo",
    }


def test_parse_info_tolerates_garbage():
    assert _parse_info(None) == {}
    assert _parse_info("not json") == {}
    assert _parse_info("[1,2,3]") == {}  # not a dict


def test_sync_inserts_new_peer(hbbs_db, session):
    _seed_peer(
        hbbs_db,
        rd_id="111 222 333",
        status=1,
        info={"ip": "::ffff:10.0.0.5", "hostname": "lab-pc", "os": "Windows"},
    )
    inserted, updated = _sync_once()
    assert inserted == 1
    assert updated == 0

    session.expire_all()
    dev = session.exec(
        select(Device).where(Device.rustdesk_id == "111 222 333")
    ).first()
    assert dev is not None
    assert dev.hostname == "lab-pc"
    assert dev.platform == "Windows"
    # IPv4-mapped IPv6 gets unwrapped.
    assert dev.last_ip == "10.0.0.5"
    # status == 1 → online → last_seen_at populated.
    assert dev.last_seen_at is not None


def test_sync_skips_when_db_missing(tmp_path, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "hbbs_db_path", tmp_path / "does-not-exist.sqlite3")
    # Must not raise — just return (0, 0).
    assert _sync_once() == (0, 0)


def test_sync_updates_changed_fields(hbbs_db, session):
    _seed_peer(
        hbbs_db,
        rd_id="444 555 666",
        status=0,
        info={"ip": "::ffff:10.0.0.6", "hostname": "old-name"},
    )
    _sync_once()
    # Now hbbs sees the peer with a new hostname + online state.
    _seed_peer(
        hbbs_db,
        rd_id="444 555 666",
        status=1,
        info={"ip": "::ffff:10.0.0.6", "hostname": "renamed", "os": "Linux"},
    )
    _, updated = _sync_once()
    assert updated == 1

    session.expire_all()
    dev = session.exec(
        select(Device).where(Device.rustdesk_id == "444 555 666")
    ).first()
    assert dev.hostname == "renamed"
    assert dev.platform == "Linux"
    assert dev.last_seen_at is not None  # online bumps it


def test_sync_offline_does_not_bump_last_seen(hbbs_db, session):
    _seed_peer(
        hbbs_db,
        rd_id="777 888 999",
        status=0,
        info={"ip": "::ffff:10.0.0.7"},
    )
    _sync_once()
    session.expire_all()
    dev = session.exec(
        select(Device).where(Device.rustdesk_id == "777 888 999")
    ).first()
    # Offline peer: we inserted the row but last_seen_at stays None so the
    # "online within 5 min" heuristic doesn't lie.
    assert dev.last_seen_at is None
