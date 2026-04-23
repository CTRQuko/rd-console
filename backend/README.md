# rd-console — backend

FastAPI + SQLModel + SQLite backend powering the rd-console admin panel.

> **Status:** v6 shipping. All routers wired against the real RustDesk client
> protocol (Flutter + free clients), plus the admin surfaces mature enough to
> drive the UI end-to-end. 192+ pytest suite.

## Layout

```
backend/
├── app/
│   ├── main.py                    FastAPI app + lifespan + bootstrap admin
│   ├── config.py                  pydantic-settings (reads RD_* env vars)
│   ├── db.py                      SQLModel engine, session, additive migrations
│   ├── security.py                argon2id + JWT + PAT hashing
│   ├── deps.py                    current-user, admin, client-secret deps
│   ├── models/
│   │   ├── address_book.py
│   │   ├── api_token.py           PAT (per-user) schema
│   │   ├── audit_log.py           AuditAction enum + AUDIT_CATEGORIES
│   │   ├── device.py
│   │   ├── join_token.py          single-use invite
│   │   ├── runtime_setting.py     k/v overrides for env settings
│   │   ├── tag.py                 now with auto + auto_source (v6)
│   │   └── user.py
│   ├── routers/
│   │   ├── address_book.py        per-user blob, matches RustDesk client API
│   │   ├── api_tokens.py          /api/auth/tokens — PATs
│   │   ├── auth.py                /api/auth/{login,me,change-password}
│   │   ├── devices.py             /admin/api/devices + PATCH + bulk
│   │   ├── join.py                /api/join/:token  (public)
│   │   ├── join_tokens.py         /admin/api/join-tokens + bulk
│   │   ├── logs.py                /admin/api/logs + soft-delete
│   │   ├── rustdesk.py            /api/heartbeat, /api/sysinfo, /api/audit/*
│   │   ├── search.py              cross-entity admin search
│   │   ├── settings_.py           /admin/api/settings/{server-info,export}
│   │   ├── tags.py                /admin/api/tags (CRUD; auto-tags read-only)
│   │   └── users.py               /admin/api/users + bulk + hard-delete
│   └── services/
│       ├── auto_tags.py           v6: tags synthesised from device attrs
│       ├── hbbs_sync.py           background loop: hbbs SQLite → devices
│       ├── rate_limit.py          in-process fixed-window limiter
│       └── server_info.py         env + runtime_setting override merge
└── tests/                         192+ pytest cases
```

## Dev quickstart

Requires Python 3.11+. Recommended: [uv](https://github.com/astral-sh/uv).

```bash
cd backend
uv venv
uv pip install -e ".[dev]"

# .env at the repo root:
cp ../.env.example ../.env
#   RD_SECRET_KEY: openssl rand -hex 32
#   RD_ADMIN_PASSWORD: the first-login password
#   RD_DB_PATH: e.g. ./rd_console.sqlite3

uv run uvicorn app.main:app --reload --port 8080
```

- API docs:    http://localhost:8080/docs
- Health:      http://localhost:8080/health

## Environment variables

All `RD_`-prefixed. The ones you'll touch most:

| Name | Role |
|------|------|
| `RD_ENVIRONMENT` | `dev` / `prod` — stricter secret validation in prod |
| `RD_DISABLE_FRONTEND` | `true` when this container runs as a headless API (UI lives elsewhere) |
| `RD_SECRET_KEY` | JWT signing key — 32+ chars in prod |
| `RD_CLIENT_SHARED_SECRET` | Gates `/api/heartbeat`, `/api/sysinfo`, `/api/audit/*` |
| `RD_ADMIN_USERNAME` / `RD_ADMIN_PASSWORD` | Bootstrap admin on first start (once) |
| `RD_SERVER_HOST` / `RD_PANEL_URL` / `RD_HBBS_PUBLIC_KEY` | Values the `/join/:token` page surfaces. Overridable at runtime from Settings → Server |
| `RD_DB_PATH` | SQLite path; defaults to `/data/rd_console.sqlite3` |
| `RD_HBBS_DB_PATH` | Read-mount of the hbbs SQLite for metadata sync |
| `RD_HBBS_SYNC_INTERVAL` | Seconds between sync ticks (≥5) |
| `RD_CORS_ORIGINS` | JSON array. Required in split deploys where the UI lives on a different origin |

## Routes (abridged — see OpenAPI for full contract)

Panel (JWT):
| Method | Path | Purpose |
|--------|------|---------|
| POST   | `/api/auth/login` | Sign-in → JWT. Rate-limited 10/min/IP |
| GET    | `/api/auth/me` | Who-am-I |
| POST   | `/api/auth/change-password` | Rotate own password |
| GET/POST/DELETE | `/api/auth/tokens` | Personal Access Tokens |
| GET/POST/PATCH/DELETE | `/admin/api/users` + `/bulk` | Users + bulk; id=1 protected |
| GET/POST/PATCH/DELETE | `/admin/api/devices` + `/bulk` | Devices |
| GET/POST/DELETE | `/admin/api/join-tokens` + `/bulk` | Invites; `?hard=true` for delete |
| GET/DELETE | `/admin/api/logs` | Audit log + soft-delete (30d retention floor) |
| GET | `/admin/api/tags` + CRUD | Tags; auto-tags read-only |
| GET/PATCH | `/admin/api/settings/server-info` | Runtime-overridable values |
| GET | `/admin/api/settings/export` | `.env`-style dump (no secrets) |

Public + client protocol:
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/join/:token` | Single-use invite redemption. Rate-limited 30/min/IP |
| POST | `/api/heartbeat` | Fed by hbbs-watcher sidecar; bumps Device.last_seen_at |
| POST | `/api/sysinfo` | Client-sourced metadata; triggers auto-tag reconciliation |
| POST | `/api/audit/conn` / `/audit/file` | Client-emitted audit events |
| POST | `/api/login` / `/api/currentUser` / `/api/logout` | kingmo888-shape aliases for the Flutter client |
| POST | `/api/ab` / `/api/ab/get` | Address book blob sync |

## Migrations

Schema evolves via `_ADDITIVE_COLUMNS` in `db.py` — plain `ALTER TABLE ADD COLUMN`
guarded by `pragma_table_info`. No Alembic yet; keep changes strictly additive.

## Testing

```bash
.venv/Scripts/python -m ruff check .
.venv/Scripts/python -m pytest -q
```

Structured around the router shape: every router has a matching `test_*.py`
covering guardrails, admin-only access, bulk edge cases, rate-limits, and
audit stamps.
