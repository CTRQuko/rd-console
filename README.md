# rd-console

Self-hosted RustDesk Server admin panel — a clean, modern replacement for the community panels.

> **Status:** scaffolding (F0) — frontend project initialized, backend pending.

## Stack

| Layer    | Technology |
|----------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS v3 + shadcn/ui |
| Backend  | FastAPI + SQLModel + SQLite |
| Auth     | JWT (panel) + Bearer token (RustDesk clients) |
| Deploy   | Docker (multi-stage) |

## Layout

```
rd-console/
├── frontend/     React + Vite project
├── backend/      FastAPI app (pending)
└── docs/         Project-local documentation
```

## Development — frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api/*` and `/admin/api/*` to `http://localhost:8080` so
the frontend can talk to the backend once it's running.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

See [docs/](docs/) for deployment notes and the implementation plan.
