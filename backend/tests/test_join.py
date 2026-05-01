"""Join token: happy path, expiry, single-use enforcement."""

from __future__ import annotations

from datetime import timedelta

from app.models.join_token import JoinToken, generate_join_token
from app.security import utcnow_naive


def _make_token(session, **overrides) -> tuple[JoinToken, str]:
    """Crea un JoinToken (post VULN-04: hash + prefix persistidos, NO
    plaintext) y devuelve `(row, plaintext)` para que los tests puedan
    `client.get(/api/join/{plaintext})`. SQLModel no permite atributos
    extra fuera de las columnas declaradas, así que tuple es el patrón."""
    plaintext, token_hash, token_prefix = generate_join_token()
    t = JoinToken(
        token_hash=token_hash,
        token_prefix=token_prefix,
        label=overrides.pop("label", "test"),
        **overrides,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t, plaintext


def test_join_happy_path(client, session, monkeypatch):
    # Settings are read from env — seed plausible values via the cached Settings.
    from app.config import get_settings
    s = get_settings()
    s.server_host = "rd.example.com"
    s.panel_url = "https://panel.example.com"
    s.hbbs_public_key = "PUBKEY"

    t, _plaintext = _make_token(session, expires_at=utcnow_naive() + timedelta(hours=1))
    r = client.get(f"/api/join/{_plaintext}")
    assert r.status_code == 200
    body = r.json()
    assert body["id_server"] == "rd.example.com"
    assert body["relay_server"] == "rd.example.com"
    assert body["api_server"] == "https://panel.example.com"
    assert body["public_key"] == "PUBKEY"
    assert body["label"] == "test"


def test_join_unknown_token_404(client):
    r = client.get("/api/join/does-not-exist")
    assert r.status_code == 404


def test_join_revoked_token_404(client, session):
    t, _plaintext = _make_token(session, revoked=True)
    r = client.get(f"/api/join/{_plaintext}")
    assert r.status_code == 404


def test_join_expired_token_410(client, session):
    t, _plaintext = _make_token(session, expires_at=utcnow_naive() - timedelta(minutes=1))
    r = client.get(f"/api/join/{_plaintext}")
    assert r.status_code == 410


def test_join_strict_single_use(client, session):
    """Second GET on a consumed token must 410 — regression for F-3."""
    t, _plaintext = _make_token(session, expires_at=utcnow_naive() + timedelta(hours=1))
    first = client.get(f"/api/join/{_plaintext}")
    assert first.status_code == 200
    second = client.get(f"/api/join/{_plaintext}")
    assert second.status_code == 410


def test_join_rejects_oversize_token(client):
    r = client.get("/api/join/" + ("x" * 200))
    assert r.status_code == 404
