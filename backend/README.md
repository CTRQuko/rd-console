# rd-console — backend

FastAPI + SQLModel + SQLite backend powering the rd-console admin panel.

> **Status:** scaffold (F3). Routers are wired with a minimal happy path; the
> RustDesk client-protocol endpoints are stubs that will need tightening when
> the real client starts talking to them in F4.

## Layout

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py           ← FastAPI app + lifespan + bootstrap admin
│   ├── config.py         ← pydantic-settings (reads RD_* env vars)
│   ├── db.py             ← SQLModel engine + session
│   ├── security.py       ← argon2id + JWT
│   ├── deps.py           ← get_current_user / require_admin
│   ├── models/           ← User, Device, AuditLog, JoinToken
│   └── routers/
│       ├── auth.py       ← /api/auth/{login,me,change-password}
│       ├── users.py      ← /admin/api/users  (admin only)
│       ├── devices.py    ← /admin/api/devices
│       ├── logs.py       ← /admin/api/logs
│       ├── settings_.py  ← /admin/api/settings/server-info
│       ├── join.py       ← /api/join/:token  (public)
│       └── rustdesk.py   ← /api/heartbeat, /api/sysinfo, /api/audit/*
├── tests/                ← pytest suite (to be filled)
└── pyproject.toml
```

## Dev quickstart

Requires Python 3.11+. Recommended: [uv](https://github.com/astral-sh/uv).

```bash
# From repo root:
cd backend
uv venv
uv pip install -e ".[dev]"

# Copy root .env.example to .env and fill it in
cp ../.env.example ../.env
#   — RD_SECRET_KEY: openssl rand -hex 32
#   — RD_ADMIN_PASSWORD: strong password for the first login
#   — RD_DB_PATH: e.g. ./rd_console.sqlite3 in dev

uv run uvicorn app.main:app --reload --port 8080
```

Open:
- API docs: http://localhost:8080/docs
- Health:   http://localhost:8080/health

## Environment variables

See `.env.example` at the repo root. All variables are prefixed `RD_` on the
environment side, un-prefixed inside `Settings`.

## Routes

| Method | Path                              | Auth       | Purpose                        |
|--------|-----------------------------------|------------|--------------------------------|
| POST   | `/api/auth/login`                 | public     | Panel login, returns JWT       |
| GET    | `/api/auth/me`                    | user       | Current user info              |
| POST   | `/api/auth/change-password`       | user       | Change own password            |
| GET    | `/admin/api/users`                | admin      | List panel users               |
| POST   | `/admin/api/users`                | admin      | Create user                    |
| PATCH  | `/admin/api/users/{id}`           | admin      | Update user                    |
| DELETE | `/admin/api/users/{id}`           | admin      | Disable user                   |
| GET    | `/admin/api/devices`              | admin      | List devices (filters)         |
| GET    | `/admin/api/devices/{id}`         | admin      | Device detail                  |
| GET    | `/admin/api/logs`                 | admin      | Audit log (paginated)          |
| GET    | `/admin/api/settings/server-info` | admin      | Server host / public key       |
| GET    | `/api/join/{token}`               | public     | Fetch RustDesk client config   |
| POST   | `/api/heartbeat`                  | client     | Device heartbeat (stub)        |
| POST   | `/api/sysinfo`                    | client     | Device system info (stub)     |
| POST   | `/api/audit/conn`                 | client     | Connection event (stub)        |
| POST   | `/api/audit/file`                 | client     | File transfer event (stub)     |
| GET    | `/health`                         | public     | Liveness probe                 |

## TODO

- [ ] `/api/login`, `/api/currentUser`, `/api/logout` for the RustDesk client
      (not the panel — shape differs from `/api/auth/login`)
- [ ] Address book sync: `GET/POST /api/ab`
- [ ] Issue bearer tokens for RustDesk clients (separate from panel JWTs)
- [ ] Join-token creation endpoint for admins (`POST /admin/api/join-tokens`)
- [ ] Rate limiting on `/api/auth/login` and `/api/join/:token`
- [ ] Alembic migrations (currently `SQLModel.metadata.create_all`)
- [ ] Prometheus metrics on `/metrics`
- [ ] pytest suite covering the routers
