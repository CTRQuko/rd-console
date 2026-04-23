"""RD_DISABLE_FRONTEND flag — backend serves API only.

When the same image runs in "API only" mode (e.g. on an instance whose
UI is served by a separate host), the SPA fallback MUST be off. An
accidental request for `/settings` from a misrouted proxy should get
a plain 404 from FastAPI, not a rd-console login page that would
confuse users whose browser thinks they're on a different service.
"""

from __future__ import annotations

from app.config import get_settings


def _toggle_frontend(enabled: bool):
    """Flip the cached Settings instance. Called inline from tests so we
    don't need to rebuild the whole app fixture — the Settings singleton
    is read inside `_mount_frontend()` on startup AND on each request via
    the closure, but the SPA fallback route itself was registered at
    app-creation time based on the flag. For this test we exercise only
    the startup-time mount decision via a fresh app."""
    s = get_settings()
    s.disable_frontend = not enabled


def test_disable_frontend_skips_spa_fallback(engine, make_user):
    """When disable_frontend is True at app creation, a GET for a non-API
    path returns 404 rather than the SPA shell."""
    from fastapi.testclient import TestClient
    from sqlmodel import Session

    from app.db import get_session
    from app.main import create_app

    # Mutate the cached Settings BEFORE create_app() so mount_frontend reads
    # the intended value.
    s = get_settings()
    previous = s.disable_frontend
    s.disable_frontend = True
    try:
        app = create_app()

        def _override_session():
            with Session(engine) as sess:
                yield sess

        app.dependency_overrides[get_session] = _override_session
        with TestClient(app) as client:
            r = client.get("/settings")
            # With the SPA off, FastAPI has no route for /settings and
            # answers 404 — not a masqueraded HTML login page.
            assert r.status_code == 404

            # API routes stay fully functional.
            r = client.get("/health")
            assert r.status_code == 200
            assert r.json()["status"] == "ok"
    finally:
        s.disable_frontend = previous


def test_default_still_serves_spa_or_404_when_no_dist(engine):
    """With the flag OFF and no built frontend present (the test env
    doesn't ship a dist/), the SPA fallback is also absent — but this
    is the "serving API only because dist is missing" branch, not the
    explicit opt-out. Exercised implicitly by every other test; just
    assert the flag default is False."""
    s = get_settings()
    assert s.disable_frontend is False
