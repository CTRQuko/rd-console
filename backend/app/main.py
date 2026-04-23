"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from . import __version__
from .config import get_settings
from .db import engine, init_db
from .models.user import User, UserRole
from .routers import (
    address_book,
    api_tokens,
    auth,
    devices,
    join,
    join_tokens,
    logs,
    rustdesk,
    search,
    settings_,
    tags,
    users,
)
from .security import hash_password

log = logging.getLogger("rd_console")


def _bootstrap_admin() -> None:
    """Create the initial admin from env vars if no admin exists yet.

    This runs once on startup. It is strictly additive — existing admins are
    never modified. To rotate the bootstrap admin password, use the panel.
    """
    s = get_settings()
    if not s.admin_password:
        log.info("RD_ADMIN_PASSWORD not set — skipping bootstrap admin creation")
        return
    with Session(engine) as session:
        existing = session.exec(
            select(User).where(User.role == UserRole.ADMIN).limit(1)
        ).first()
        if existing:
            log.info("Admin already exists — bootstrap password ignored")
            return
        admin = User(
            username=s.admin_username,
            password_hash=hash_password(s.admin_password),
            role=UserRole.ADMIN,
            is_active=True,
        )
        session.add(admin)
        session.commit()
        log.warning(
            "Bootstrap admin '%s' created. Change the password on first login.",
            s.admin_username,
        )


def _warn_startup(s) -> None:
    """Log hard warnings for weak/unset security knobs."""
    if s.environment != "prod":
        return
    if not s.client_shared_secret:
        log.warning(
            "RD_CLIENT_SHARED_SECRET is empty — /api/heartbeat, /api/sysinfo "
            "and /api/audit/* are OPEN to the internet."
        )


# ─── Frontend static serving ────────────────────────────────────────────────
# When packaged with Docker, the built Vite frontend lands at /app/frontend.
# In dev you can override via RD_FRONTEND_DIST. If the directory does not
# exist (e.g. backend-only dev run), the SPA mount is skipped and the API
# still works as before.
_DEFAULT_DIST_CANDIDATES = (
    Path("/app/frontend"),
    Path(__file__).resolve().parent.parent.parent / "frontend" / "dist",
)

# Routes that must NEVER be intercepted by the SPA fallback. Anything else
# that is a GET and is not an API route is treated as a client-side route
# and returns index.html so React Router can take over.
_API_PREFIXES = ("/api/", "/admin/api/", "/openapi", "/docs", "/redoc", "/health")


def _find_frontend_dist() -> Path | None:
    from os import environ

    override = environ.get("RD_FRONTEND_DIST")
    if override:
        p = Path(override)
        if p.is_dir():
            return p
    for candidate in _DEFAULT_DIST_CANDIDATES:
        if candidate.is_dir():
            return candidate
    return None


def _mount_frontend(app: FastAPI) -> None:
    if get_settings().disable_frontend:
        log.info("RD_DISABLE_FRONTEND=true — serving API only, no SPA mounted")
        return
    dist = _find_frontend_dist()
    if dist is None:
        log.info("No frontend build found — serving API only")
        return

    index_html = dist / "index.html"
    if not index_html.is_file():
        log.warning("Frontend dist %s missing index.html — skipping mount", dist)
        return

    log.info("Serving frontend from %s", dist)

    # Hashed assets + fonts — long-cache by filename.
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    if (dist / "fonts").is_dir():
        app.mount("/fonts", StaticFiles(directory=dist / "fonts"), name="fonts")

    # SPA fallback: every non-API GET returns index.html and React Router
    # handles the path client-side.
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        lead = "/" + full_path
        if any(lead.startswith(p) for p in _API_PREFIXES):
            # If an API route reached here, it's because the router didn't match
            # — return a proper 404 instead of silently serving HTML.
            raise HTTPException(status_code=404, detail="Not found")
        # Serve the specific file if it exists at the dist root (favicon.svg,
        # icons.svg, etc.); otherwise fall back to index.html.
        candidate = dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_html)


@asynccontextmanager
async def lifespan(_: FastAPI):
    import asyncio

    from .services.hbbs_sync import run_sync_loop

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    init_db()
    _bootstrap_admin()
    _warn_startup(get_settings())
    # Kick off the hbbs → devices sync in the background. If the hbbs DB
    # isn't mounted (dev env) the task just no-ops every tick.
    import contextlib

    sync_task = asyncio.create_task(run_sync_loop(), name="hbbs-sync")
    try:
        yield
    finally:
        sync_task.cancel()
        # Swallow both the CancelledError we just triggered and any
        # tick-level exception — a shutdown hook should never raise.
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await sync_task


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="rd-console",
        version=__version__,
        description="Self-hosted RustDesk Server admin panel",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-RD-Secret"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    # Panel (JWT-authenticated)
    app.include_router(auth.router)
    app.include_router(api_tokens.router)
    app.include_router(users.router)
    app.include_router(devices.router)
    app.include_router(logs.router)
    app.include_router(settings_.router)
    app.include_router(tags.router)
    app.include_router(search.router)
    app.include_router(address_book.router)
    app.include_router(join_tokens.router)

    # Public
    app.include_router(join.router)

    # RustDesk client protocol (optionally gated by X-RD-Secret)
    app.include_router(rustdesk.router)

    # Frontend LAST so the catch-all doesn't shadow API routes.
    _mount_frontend(app)

    return app


app = create_app()
