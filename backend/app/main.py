"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from . import __version__
from .config import get_settings
from .db import engine, init_db
from .models.user import User, UserRole
from .routers import auth, devices, join, logs, rustdesk, settings_, users
from .security import hash_password

log = logging.getLogger("rd_console")


def _bootstrap_admin() -> None:
    """Create the initial admin from env vars if no admin exists yet."""
    s = get_settings()
    if not s.admin_password:
        log.info("RD_ADMIN_PASSWORD not set — skipping bootstrap admin creation")
        return
    with Session(engine) as session:
        has_admin = session.exec(
            select(User).where(User.role == UserRole.ADMIN).limit(1)
        ).first()
        if has_admin:
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    init_db()
    _bootstrap_admin()
    yield


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
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    # Panel (JWT-authenticated)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(devices.router)
    app.include_router(logs.router)
    app.include_router(settings_.router)

    # Public
    app.include_router(join.router)

    # RustDesk client protocol
    app.include_router(rustdesk.router)

    return app


app = create_app()
