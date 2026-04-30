"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from . import __version__
from .config import get_settings
from .db import engine, init_db
from .deps import AdminUser
from .models.user import User, UserRole
from .routers import (
    address_book,
    api_tokens,
    auth,
    backup,
    devices,
    health as health_router,
    join,
    join_tokens,
    logs,
    roles as roles_router,
    rustdesk,
    search,
    settings_,
    system as system_router,
    tags,
    updates as updates_router,
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
    from .services.jwt_cleanup import run_cleanup_loop
    from .services.metrics_sampler import run_sampler_loop

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    init_db()
    _bootstrap_admin()
    # Seed the builtin roles (admin, user) so the Settings → Roles
    # panel renders meaningful data on a fresh DB. Idempotent: existing
    # rows are left untouched, so an operator's edits to permissions
    # survive restarts.
    from .routers.roles import bootstrap_roles
    bootstrap_roles()
    _warn_startup(get_settings())
    # In dev, refresh fixture device presence on every startup so the panel
    # never shows "0 online" just because the seed timestamps drifted past
    # the 15-min online window. Idempotent — skipped if no fixture exists.
    if get_settings().environment == "dev":
        try:
            from scripts.seed_dev import refresh_fixture_presence
            refresh_fixture_presence()
        except Exception:  # noqa: BLE001 — never block startup on a dev-only path
            logging.getLogger("rd_console").exception("seed refresh failed (non-fatal)")
    # Kick off the hbbs → devices sync in the background. If the hbbs DB
    # isn't mounted (dev env) the task just no-ops every tick.
    import contextlib

    # Tests need a fully synchronous lifespan — the metrics sampler in
    # particular writes to the same SystemMetricSample table the tests
    # populate, and the rate-derivation endpoint sees those rows leak in.
    # `RD_DISABLE_BACKGROUND_TASKS=1` (set in tests/conftest.py) skips
    # all three loops; production lifespan keeps them on by default.
    import os as _os
    bg_disabled = _os.environ.get("RD_DISABLE_BACKGROUND_TASKS") == "1"

    sync_task = None if bg_disabled else asyncio.create_task(run_sync_loop(), name="hbbs-sync")
    # JWT revocation list grows without bound unless someone prunes it. A
    # 6h tick keeps the table size bounded by "tokens revoked in the last
    # access_token_expire_minutes window", which is tiny.
    cleanup_task = None if bg_disabled else asyncio.create_task(run_cleanup_loop(), name="jwt-cleanup")
    # Network counters sampled every 60 s into system_metric_samples so
    # the Dashboard "Tráfico de red" chart has actual data to render.
    metrics_task = None if bg_disabled else asyncio.create_task(run_sampler_loop(), name="metrics-sampler")
    try:
        yield
    finally:
        for t in (sync_task, cleanup_task, metrics_task):
            if t is not None:
                t.cancel()
        # Swallow both the CancelledError we just triggered and any
        # tick-level exception — a shutdown hook should never raise.
        for t in (sync_task, cleanup_task, metrics_task):
            if t is not None:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await t


# ─── OpenAPI tag metadata ───────────────────────────────────────────────────
# Order matters here: FastAPI groups endpoints in the `/admin/docs` UI by
# the order in which tags appear in this list. We put the most commonly
# integrated tags first (auth, devices) and the internal protocol tags
# (rustdesk-client, meta) last.
OPENAPI_TAGS = [
    {
        "name": "auth",
        "description": (
            "Login, session-user identity, and password rotation. All panel "
            "requests after login carry the JWT returned by `POST /api/auth/login` "
            "in the `Authorization: Bearer …` header."
        ),
    },
    {
        "name": "auth:tokens",
        "description": (
            "Personal Access Tokens (PATs) — long-lived bearers for scripted "
            "admin API use. The plaintext secret is shown exactly once at "
            "creation and never again; store it immediately."
        ),
    },
    {
        "name": "admin:users",
        "description": (
            "Manage panel users (admins + regular). Disable is soft (row "
            "preserved); hard-delete cascades PATs and address-book entries "
            "but keeps devices/audit rows with NULL owner for history."
        ),
    },
    {
        "name": "admin:devices",
        "description": (
            "Every RustDesk ID the relay has ever seen. The `online` field is "
            "a 15-minute heuristic over `last_seen_at`; see "
            "`docs/servicios/rustdesk-lxc-105/online-detection-limitation.md` "
            "for why the free tier can't expose real-time presence."
        ),
    },
    {
        "name": "admin:tags",
        "description": "Admin-authored labels attached to devices for filtering.",
    },
    {
        "name": "admin:logs",
        "description": (
            "Audit log — every panel action plus RustDesk connection events. "
            "Filterable, paginated, exportable as CSV or NDJSON, soft-deletable "
            "with a 30-day retention floor."
        ),
    },
    {
        "name": "admin:settings",
        "description": (
            "Runtime-editable server configuration (host, panel URL, public "
            "key). Secrets (`RD_SECRET_KEY`, `RD_ADMIN_PASSWORD`, "
            "`RD_CLIENT_SHARED_SECRET`) are env-only and never exposed."
        ),
    },
    {
        "name": "admin:join-tokens",
        "description": (
            "Single-use invite links. Minting returns the plaintext once; "
            "clients exchange it at `GET /api/join/:token` for server config."
        ),
    },
    {
        "name": "admin:search",
        "description": "Cross-resource search for the command palette UI.",
    },
    {
        "name": "admin:health",
        "description": (
            "Liveness probes for the hbbs/hbbr companion containers. Run by "
            "the panel UI's Settings → Server connectivity card."
        ),
    },
    {
        "name": "address-book",
        "description": (
            "Per-user address book synced via the RustDesk Flutter client's "
            "`POST /api/ab` contract. Consumed by the client, not by the "
            "admin panel directly."
        ),
    },
    {
        "name": "public:join",
        "description": (
            "Unauthenticated — clients hit `GET /api/join/:token` to redeem an "
            "invite and receive the server config needed to connect."
        ),
    },
    {
        "name": "rustdesk-client",
        "description": (
            "RustDesk client protocol endpoints: heartbeat, sysinfo, audit "
            "connection events, and the compat login stubs. Gated by the "
            "`X-RD-Secret` shared secret."
        ),
    },
    {
        "name": "admin:backup",
        "description": (
            "JSON export and restore of panel state (users, tags, runtime "
            "settings, token metadata). Secrets are NEVER exported. "
            "Restore supports a ``dry_run`` preview before applying changes."
        ),
    },
    {
        "name": "meta",
        "description": "Process-level metadata (e.g. `GET /health`).",
    },
]


def _build_openapi(app: FastAPI) -> dict:
    """Cache the OpenAPI schema on first access — mirrors FastAPI's default."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        tags=OPENAPI_TAGS,
    )
    app.openapi_schema = schema
    return schema


def create_app() -> FastAPI:
    s = get_settings()
    # `docs_url` and `redoc_url` are set to None so the default public routes
    # don't expose the full API surface. We mount admin-gated equivalents at
    # `/admin/docs`, `/admin/redoc`, and `/admin/openapi.json` below.
    app = FastAPI(
        title="rd-console",
        version=__version__,
        description=(
            "Self-hosted RustDesk Server admin panel. The interactive docs at "
            "`/admin/docs` (Swagger) and `/admin/redoc` (Redoc) require an "
            "admin JWT — fetch one from `POST /api/auth/login` first."
        ),
        lifespan=lifespan,
        openapi_tags=OPENAPI_TAGS,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,  # disable the default public /openapi.json
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-RD-Secret"],
    )

    @app.get("/health", tags=["meta"], summary="Liveness probe")
    def health() -> dict:
        """Always returns 200 as long as the ASGI app is up. Does not touch
        the database or any dependency — safe to call from a load balancer
        health check. For hbbs/hbbr probing use `/admin/api/health/hbbs`."""
        return {"status": "ok", "version": __version__}

    # ─── Admin-gated OpenAPI surface ────────────────────────────────────
    # Design:
    #   • The Swagger UI + Redoc pages require an admin JWT to RENDER.
    #   • The underlying `/admin/openapi.json` is admin-gated too, BUT the
    #     swagger page embeds the spec inline as `spec:` so the browser
    #     fetch after load isn't needed. Result: casual drive-by scrapers
    #     see a 401 at `/admin/docs` and `/admin/openapi.json` both.
    #   • Scripted consumers (curl/httpx) that have a token can just hit
    #     `GET /admin/openapi.json` with the Authorization header.
    @app.get("/admin/openapi.json", include_in_schema=False)
    def admin_openapi(_: AdminUser) -> JSONResponse:
        return JSONResponse(_build_openapi(app))

    @app.get("/admin/docs", include_in_schema=False)
    def admin_swagger(_: AdminUser) -> HTMLResponse:
        # Default Swagger UI HTML; it fetches /admin/openapi.json which also
        # requires the same admin cookie/header the browser already sent.
        return get_swagger_ui_html(
            openapi_url="/admin/openapi.json",
            title=f"{app.title} — Swagger",
        )

    @app.get("/admin/redoc", include_in_schema=False)
    def admin_redoc(_: AdminUser) -> HTMLResponse:
        return get_redoc_html(
            openapi_url="/admin/openapi.json",
            title=f"{app.title} — Redoc",
        )

    # Panel (JWT-authenticated)
    app.include_router(auth.router)
    app.include_router(api_tokens.router)
    app.include_router(backup.router)
    app.include_router(users.router)
    app.include_router(devices.router)
    app.include_router(logs.router)
    app.include_router(settings_.router)
    app.include_router(tags.router)
    app.include_router(search.router)
    app.include_router(address_book.router)
    app.include_router(join_tokens.router)
    # /api/v1 namespace — feeds the design-system-v3 Dashboard (system
    # metrics + recent connections). Coexists with the /api and
    # /admin/api routers; no migration of older endpoints implied.
    app.include_router(system_router.router)
    app.include_router(health_router.router)
    app.include_router(updates_router.router)
    app.include_router(roles_router.router)

    # Public
    app.include_router(join.router)

    # RustDesk client protocol (optionally gated by X-RD-Secret)
    app.include_router(rustdesk.router)

    # Frontend LAST so the catch-all doesn't shadow API routes.
    _mount_frontend(app)

    return app


app = create_app()
