# rd-console

Self-hosted RustDesk Server admin panel. A modern replacement for kingmo888 / rustdesk-api-server, focused on UX clarity, auditability, and single-operator ergonomics.

> **Status:** v6 — shipping. See [docs/v6-changelog.md](docs/v6-changelog.md) for the active release notes.

## What it does

- Manages panel users (admins + regular), authenticated via JWT.
- Lists every RustDesk device the server has seen, with online / offline / metadata, fed by a background sync from the hbbs SQLite + real-time heartbeats from a log-tailing sidecar.
- Mints single-use invite links (`/join/:token`) so onboarding a new client is "send a URL" instead of "tell them to paste these three values".
- Per-user API tokens (PATs) for scripted admin API usage.
- Per-user Address Book synced via `POST /api/ab` — the same contract the RustDesk Flutter client speaks.
- Audit log of every panel action + connection event, filterable + exportable as CSV/NDJSON + soft-deletable with a 30-day retention floor.
- Panel-wide appearance prefs (theme, accent, font scale, sidebar style) persisted per browser via localStorage + data-attributes.

## Stack

| Layer    | Technology |
|----------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind v3 + custom design system (`src/design/*.css`) |
| Backend  | FastAPI + SQLModel + SQLite |
| Auth     | JWT (panel) · PAT (scripts) · X-RD-Secret shared secret (client protocol) |
| Deploy   | Docker (all-in-one or split frontend/backend) |

## Layout

```
rd-console/
├── backend/               FastAPI app + tests
├── frontend/              React + Vite
├── scripts/
│   ├── deployment/        LXC deploy + recreate helpers
│   └── hbbs-watcher/      Sidecar bash script: tails hbbs logs → /api/heartbeat
├── Dockerfile             All-in-one image (API + SPA in one container)
├── Dockerfile.frontend    Frontend-only image (nginx, calls remote API)
└── docs/
```

## Deploy modes

### All-in-one (single container)

One Docker image serves both API and SPA. `docker build -f Dockerfile` → run it, done. Used on the production LXC 105 pre-v6.

### Split (v6+)

The LXC hosts a **headless backend** (`RD_DISABLE_FRONTEND=true`) that answers only `/api/*` and `/admin/api/*`. A separate host (e.g. mac-mini) hosts an nginx image built from `Dockerfile.frontend` with `VITE_API_BASE` pointing at the backend's public URL. Benefits:

- Staging UI can live anywhere without redeploying the production API.
- A reverse-proxy misroute won't accidentally serve an unrelated hostname the panel's login shell.
- CORS is the only coupling between the two hosts.

Build the frontend-only image:
```bash
docker build \
  --build-arg VITE_API_BASE=https://rustdesk.casaredes.cc \
  -f Dockerfile.frontend \
  -t rd-console-ui:latest .
```

## Development — frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api/*` and `/admin/api/*` to `http://localhost:8080` unless `VITE_API_BASE` is set (then axios calls that URL directly).

## Development — backend

See [backend/README.md](backend/README.md).

## Configuration

Copy `.env.example` → `.env`. Runtime-editable values (`RD_SERVER_HOST`, `RD_PANEL_URL`, `RD_HBBS_PUBLIC_KEY`) can be overridden from Settings → Server; everything else is env-only.

## Testing

```bash
# Backend
cd backend && .venv/Scripts/python -m pytest   # 192+ tests
# Frontend
cd frontend && npx vitest run                   # 100+ tests
```

## Contributing

Read [docs/v6-changelog.md](docs/v6-changelog.md) for the active work and conventions. Commits follow [Conventional Commits](https://www.conventionalcommits.org/); tests are non-negotiable (every PR lands with coverage).
