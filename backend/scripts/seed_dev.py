"""Seed the dev DB with synthetic data so the design-system-v3 pages
render with life when iterating locally.

First-run only: if the DB already has >2 devices, the script does
nothing (assume someone seeded it before). To force a re-seed, wipe
backend/data/rd_console.dev.db first.

Usage:
    cd backend
    .venv/Scripts/python -m scripts.seed_dev

Populates:
- 6 users (admin + 5 fake operators) with usable emails
- 8 tags spanning the design's color palette
- 16 devices with mixed platforms / online state / last-seen / tag
  assignments / favorites / notes
- ~80 audit_log rows: CONNECT / DISCONNECT / FILE_TRANSFER /
  user_management events spread over the last 24 h
- 5 join tokens (active / expired / revoked / used)
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.db import engine
from app.models.audit_log import AuditAction, AuditLog
from app.models.device import Device
from app.models.join_token import JoinToken
from app.models.tag import DeviceTag, Tag
from app.models.user import User, UserRole
from app.security import hash_password, utcnow_naive

random.seed(0xCAFE)  # deterministic seed for reproducible local dev

USER_FIXTURES: list[tuple[str, str, str, UserRole]] = [
    ("alex",    "alex@casaredes.cc",    "Alex M.",    UserRole.ADMIN),
    ("diana",   "diana@casaredes.cc",   "Diana R.",   UserRole.USER),
    ("carlos",  "carlos@casaredes.cc",  "Carlos P.",  UserRole.USER),
    ("lab",     "lab@casaredes.cc",     "Lab Ops",    UserRole.USER),
    ("ci",      "ci@casaredes.cc",      "CI Bot",     UserRole.USER),
]

TAG_FIXTURES: list[tuple[str, str]] = [
    ("personal", "violet"),
    ("design",   "amber"),
    ("servers",  "blue"),
    ("ci",       "blue"),
    ("lab",      "green"),
    ("kiosk",    "rose"),
    ("remote",   "violet"),
    ("legacy",   "zinc"),
]

DEVICE_FIXTURES = [
    # (rustdesk_id, hostname, platform, version, owner_username, online_minutes_ago, ip, tags, note, fav)
    ("123456789", "alex-laptop",      "macOS 14.5",          "1.3.2",  "alex",   1,    "10.0.4.18",   ["personal"],          "Portátil del operador admin. Acceso completo al relay.", True),
    ("234567890", "design-mac-01",    "macOS 14.4",          "1.3.2",  "diana",  3,    "10.0.4.32",   ["design"],            "", False),
    ("345678901", "build-srv-eu",     "Ubuntu 22.04",        "1.3.1",  "ci",     0,    "10.0.20.7",   ["servers", "ci"],     "Servidor de build CI/CD. **No reiniciar entre 02:00–06:00 UTC** (corre nightlies).", False),
    ("456789012", "lab-pc-04",        "Windows 11",          "1.2.9",  "lab",    65,   "10.0.7.4",    ["lab"],               "", False),
    ("567890123", "kiosk-front",      "Windows 10 LTSC",     "1.2.8",  "carlos", 240,  "10.0.50.1",   ["kiosk"],             "Kiosko de recepción. Usuario sin permisos de cierre de sesión.", False),
    ("678901234", "diana-mbp",        "macOS 14.5",          "1.3.2",  "diana",  5,    "10.0.4.40",   ["design", "remote"],  "", True),
    ("789012345", "qa-rig",           "Windows 11",          "1.3.0",  "carlos", 12,   "10.0.10.99",  ["lab"],               "", False),
    ("890123456", "old-router",       "Linux (custom)",      "1.1.3",  "lab",    7 * 24 * 60, "10.0.0.1", ["legacy"],         "Router viejo. Marcado para retirada Q1.", False),
    ("901234567", "carlos-thinkpad",  "Ubuntu 24.04",        "1.3.2",  "carlos", 2,    "10.0.4.50",   ["personal", "remote"],"", False),
    ("012345678", "render-farm-01",   "Windows Server 2022", "1.3.0",  "ci",     8,    "10.0.20.10",  ["servers"],           "Render farm. ECC RAM, RTX 4090 ×2.", True),
    ("111223344", "render-farm-02",   "Windows Server 2022", "1.3.0",  "ci",     11,   "10.0.20.11",  ["servers"],           "", False),
    ("222334455", "abuela-laptop",    "Windows 10",          "1.2.6",  "alex",   30,   "192.168.1.42", [],                   "Soporte familiar. Llamar si pide ayuda.", False),
    ("333445566", "kiosk-back",       "Windows 10 LTSC",     "1.2.8",  "carlos", 22,   "10.0.50.2",   ["kiosk"],             "", False),
    ("444556677", "android-test",     "Android 14",          "1.3.2",  "lab",    18,   "10.0.7.66",   ["lab", "remote"],     "Pruebas de cliente Android.", False),
    ("555667788", "ipad-design",      "iOS 18.2",            "1.3.1",  "diana",  4,    "10.0.4.55",   ["design", "remote"],  "iPad Pro 13' M4 — Diana usa para retoque rápido.", False),
    ("666778899", "media-pi",         "Raspberry Pi OS",     "1.3.0",  "alex",   90,   "10.0.30.4",   [],                    "RPi 5 con Jellyfin.", False),
]

NOW = utcnow_naive()


def _seed_users(session: Session) -> dict[str, int]:
    """Insert fixture users (skip if username exists). Returns name→id map."""
    by_name: dict[str, int] = {}
    for username, email, display_name, role in USER_FIXTURES:
        existing = session.exec(select(User).where(User.username == username)).first()
        if existing:
            by_name[username] = existing.id
            continue
        u = User(
            username=username,
            email=email,
            password_hash=hash_password("changeme123"),
            role=role,
            is_active=True,
            created_at=NOW - timedelta(days=random.randint(30, 200)),
            last_login_at=NOW - timedelta(minutes=random.randint(1, 60 * 24 * 7)),
        )
        session.add(u)
        session.commit()
        session.refresh(u)
        by_name[username] = u.id
    return by_name


def _seed_tags(session: Session) -> dict[str, int]:
    """Insert fixture tags. Returns name→id map."""
    by_name: dict[str, int] = {}
    for name, color in TAG_FIXTURES:
        existing = session.exec(select(Tag).where(Tag.name == name)).first()
        if existing:
            by_name[name] = existing.id
            continue
        t = Tag(name=name, color=color, created_at=NOW - timedelta(days=random.randint(10, 60)))
        session.add(t)
        session.commit()
        session.refresh(t)
        by_name[name] = t.id
    return by_name


def _seed_devices(
    session: Session, users_by_name: dict[str, int], tags_by_name: dict[str, int]
) -> list[Device]:
    """Insert fixture devices + their tag assignments."""
    out: list[Device] = []
    for (rd_id, hostname, platform, version, owner, mins_ago, ip, tag_names, note, fav) in DEVICE_FIXTURES:
        existing = session.exec(select(Device).where(Device.rustdesk_id == rd_id)).first()
        if existing:
            out.append(existing)
            continue
        d = Device(
            rustdesk_id=rd_id,
            hostname=hostname,
            username=owner,
            platform=platform,
            version=version,
            owner_user_id=users_by_name.get(owner),
            last_ip=ip,
            last_seen_at=NOW - timedelta(minutes=mins_ago),
            created_at=NOW - timedelta(days=random.randint(1, 90)),
            note=note or None,
            is_favorite=fav,
        )
        session.add(d)
        session.commit()
        session.refresh(d)
        for tag_name in tag_names:
            tid = tags_by_name.get(tag_name)
            if tid is None:
                continue
            session.add(DeviceTag(device_id=d.id, tag_id=tid))
        session.commit()
        out.append(d)
    return out


def _seed_audit_logs(session: Session, devices: list[Device], users_by_name: dict[str, int]) -> None:
    """80-ish CONNECT/DISCONNECT/FILE_TRANSFER events spread over 24h, plus
    a handful of user-management events to give the LogsPage variety."""
    if devices:
        session_actions = [AuditAction.CONNECT, AuditAction.DISCONNECT, AuditAction.FILE_TRANSFER, AuditAction.CLOSE]
        for _ in range(80):
            from_d = random.choice(devices)
            to_d = random.choice(devices)
            if from_d.id == to_d.id:
                to_d = devices[(devices.index(to_d) + 1) % len(devices)]
            ts = NOW - timedelta(minutes=random.randint(1, 24 * 60))
            session.add(
                AuditLog(
                    action=random.choice(session_actions),
                    from_id=from_d.rustdesk_id,
                    to_id=to_d.rustdesk_id,
                    ip=from_d.last_ip,
                    actor_user_id=from_d.owner_user_id,
                    created_at=ts,
                )
            )

    # 6 user-management events so /logs?category=user_management has rows
    actor_id = users_by_name.get("alex")
    user_actions = [
        AuditAction.USER_CREATED,
        AuditAction.USER_UPDATED,
        AuditAction.USER_DISABLED,
        AuditAction.USER_ENABLED,
        AuditAction.SETTINGS_CHANGED,
        AuditAction.LOGIN,
    ]
    for action in user_actions:
        session.add(
            AuditLog(
                action=action,
                actor_user_id=actor_id,
                ip="192.168.1.10",
                created_at=NOW - timedelta(hours=random.randint(1, 48)),
            )
        )
    session.commit()


def _seed_join_tokens(session: Session, users_by_name: dict[str, int]) -> None:
    """Active / expired / revoked / used / never-expires variants."""
    actor_id = users_by_name.get("alex")
    fixtures = [
        # (label, expires_at, used_at, revoked)
        ("Abuela — laptop",       NOW + timedelta(days=2),    None, False),
        ("Carlos macbook nuevo",  NOW + timedelta(hours=18),  None, False),
        ("Lab — kiosk recepción", None,                       None, False),
        ("CI bot prod",           NOW + timedelta(days=30),   NOW - timedelta(hours=4), False),
        ("Token caducado",        NOW - timedelta(hours=2),   None, False),
        ("Token revocado",        NOW + timedelta(days=7),    None, True),
    ]
    for label, expires_at, used_at, revoked in fixtures:
        session.add(
            JoinToken(
                label=label,
                created_by_user_id=actor_id,
                created_at=NOW - timedelta(hours=random.randint(1, 72)),
                expires_at=expires_at,
                used_at=used_at,
                revoked=revoked,
            )
        )
    session.commit()


def main() -> None:
    with Session(engine) as session:
        existing_devices = session.exec(select(Device)).all()
        if len(existing_devices) > 2:
            print(f"Skipping seed — DB already has {len(existing_devices)} devices.")
            print("Wipe backend/data/rd_console.dev.db to force re-seed.")
            return

        print("[*] seeding users...")
        users_by_name = _seed_users(session)
        print(f"    {len(users_by_name)} users present")

        print("[*] seeding tags...")
        tags_by_name = _seed_tags(session)
        print(f"    {len(tags_by_name)} tags present")

        print("[*] seeding devices + tag assignments...")
        devices = _seed_devices(session, users_by_name, tags_by_name)
        print(f"    {len(devices)} devices present")

        print("[*] seeding audit logs (sessions + user mgmt)...")
        _seed_audit_logs(session, devices, users_by_name)

        print("[*] seeding join tokens...")
        _seed_join_tokens(session, users_by_name)

        print("[OK] seed complete.")


if __name__ == "__main__":
    main()
