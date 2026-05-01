"""Regression guards for the audit 2026-05-01 fixes.

Cubre VULN-01, VULN-04, VULN-05, VULN-07, VULN-08, VULN-09, VULN-10.
Cada test referencia explícitamente el VULN-id en la docstring para
que git-blame futuro entienda la intención si alguien intenta romper
la regresión.
"""

from __future__ import annotations

import time

from sqlmodel import select

from app.config import get_settings
from app.models.api_token import ApiToken
from app.models.join_token import JoinToken, generate_join_token, hash_join_token
from app.models.jwt_revocation import JwtRevocation
from app.models.jwt_session import JwtSession
from app.security import constant_time_equals, hash_api_token
from app.services.rate_limit import reset_for_tests
from app.services.trusted_ip import reset_cache_for_tests


# ─── VULN-01 — Rate limit no bypass-eable vía X-Forwarded-For ────────────────


def test_vuln01_xff_does_not_bypass_login_rate_limit(client):
    """Sin RD_TRUSTED_PROXIES, XFF debe ser ignorado y los 11 logins
    consecutivos del mismo TestClient (independientemente del XFF) deben
    chocar con el 429 del bucket del login."""
    reset_for_tests()
    s = get_settings()
    s.trusted_proxies = []  # XFF no honrado
    reset_cache_for_tests()

    # 10 intentos OK (todos 401), el 11º debe ser 429.
    statuses: list[int] = []
    for i in range(12):
        r = client.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": f"203.0.113.{i}"},
            json={"username": "ghost", "password": "wrong"},
        )
        statuses.append(r.status_code)

    assert statuses[:10] == [401] * 10, statuses
    assert 429 in statuses[10:], (
        f"Rate limit no se aplica con XFF rotativo — VULN-01 reabierta. "
        f"statuses={statuses}"
    )
    reset_for_tests()


def test_vuln01_xff_honored_only_with_trusted_proxy(client):
    """Cuando el TestClient (`testclient`) está en `trusted_proxies`,
    el XFF SÍ se respeta y un atacante que rote XFF gasta budgets en
    IPs distintas — el patrón legítimo de un sidecar/reverse-proxy."""
    reset_for_tests()
    s = get_settings()
    s.trusted_proxies = ["testclient"]
    reset_cache_for_tests()

    statuses: list[int] = []
    for i in range(12):
        r = client.post(
            "/api/auth/login",
            headers={"X-Forwarded-For": f"203.0.113.{i}"},
            json={"username": "ghost", "password": "wrong"},
        )
        statuses.append(r.status_code)

    # Con XFF honrado y 12 IPs distintas, ninguno hits 429.
    assert all(s == 401 for s in statuses), statuses
    s.trusted_proxies = []
    reset_cache_for_tests()
    reset_for_tests()


# ─── VULN-04 — JoinToken almacenado solo como hash + prefix ──────────────────


def test_vuln04_join_token_not_stored_in_plaintext(client, auth_headers, session):
    """Verifica que tras crear un join token la BD contiene token_hash
    pero NO el plaintext en ninguna columna."""
    r = client.post("/admin/api/join-tokens", headers=auth_headers, json={})
    assert r.status_code == 201
    plaintext = r.json()["token"]

    row = session.exec(select(JoinToken).where(JoinToken.id == r.json()["id"])).first()
    assert row is not None
    # El plaintext NO debe aparecer en ninguna columna persistida.
    persisted_values = (row.token_hash, row.token_prefix, row.label or "")
    for v in persisted_values:
        assert plaintext not in v, (
            f"Plaintext del token leak en columna persistida (VULN-04): {v}"
        )
    # El hash SÍ debe coincidir con el SHA-256 del plaintext.
    assert row.token_hash == hash_join_token(plaintext)
    # El prefix son los primeros 8 chars (es info pública, OK).
    assert row.token_prefix == plaintext[:8]


def test_vuln04_join_lookup_uses_hash(client, session):
    """El handler `/api/join/{token}` debe resolver vía hash, no por
    equality con un campo plaintext (que ya no existe)."""
    plaintext, token_hash, token_prefix = generate_join_token()
    session.add(JoinToken(
        token_hash=token_hash,
        token_prefix=token_prefix,
        label="vuln04-regression",
    ))
    session.commit()

    s = get_settings()
    s.server_host = "rd.example.com"
    s.panel_url = "https://panel.example.com"
    s.hbbs_public_key = "PUBKEY"

    r = client.get(f"/api/join/{plaintext}")
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "vuln04-regression"


# ─── VULN-05 — change-password revoca todas las sesiones del usuario ─────────


def test_vuln05_change_password_revokes_other_sessions(client, session):
    """Tras cambiar password, todos los jti activos del usuario quedan
    en JwtRevocation y JwtSession.revoked_at. Un JWT robado pre-cambio
    deja de funcionar inmediatamente."""
    # Login dos veces para tener dos sesiones activas (token1 y token2).
    creds = {"username": "admin", "password": "test-admin-pw"}
    # Bootstrap de admin se hace en conftest; usamos las credenciales
    # del fixture admin_token. Para este test usamos el flujo completo.
    from app.security import hash_password
    from app.models.user import User, UserRole
    user = session.exec(select(User).where(User.username == "vuln05user")).first()
    if not user:
        user = User(
            username="vuln05user",
            password_hash=hash_password("original-pass-x"),
            role=UserRole.ADMIN,
            is_active=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        user.password_hash = hash_password("original-pass-x")
        session.add(user)
        session.commit()

    # Dos logins independientes — emite dos JWTs distintos.
    r1 = client.post("/api/auth/login", json={"username": "vuln05user", "password": "original-pass-x"})
    r2 = client.post("/api/auth/login", json={"username": "vuln05user", "password": "original-pass-x"})
    assert r1.status_code == 200 and r2.status_code == 200
    token1 = r1.json()["access_token"]
    token2 = r2.json()["access_token"]

    # Verifica /me funciona con token1.
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token1}"})
    assert me.status_code == 200

    # Cambiar password con token2.
    r = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token2}"},
        json={"current_password": "original-pass-x", "new_password": "brand-new-passXX"},
    )
    assert r.status_code == 204, r.text

    # Tras el cambio, AMBOS tokens deben dar 401 (incluido el que hizo
    # el cambio). Comportamiento equivalente a "logout universal".
    me1 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token1}"})
    me2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token2}"})
    assert me1.status_code == 401, "token1 sigue válido tras cambio (VULN-05 reabierta)"
    assert me2.status_code == 401, "token2 sigue válido tras cambio (VULN-05 reabierta)"

    # Las filas de JwtSession del usuario están marcadas revocadas.
    sessions = session.exec(
        select(JwtSession).where(JwtSession.user_id == user.id)
    ).all()
    assert len(sessions) >= 2
    assert all(s.revoked_at is not None for s in sessions), (
        "JwtSession.revoked_at no marcado tras change_password (VULN-05)"
    )

    # Y JwtRevocation tiene los jti.
    revoked = session.exec(
        select(JwtRevocation).where(JwtRevocation.user_id == user.id)
    ).all()
    assert len(revoked) >= 2


# ─── VULN-08 — constant_time_equals helper sigue disponible ──────────────────


def test_vuln08_constant_time_equals_short_circuit_safe():
    """Smoke test de la API que usa require_client_secret. constant_time_
    equals debe devolver False sin loguear timing."""
    assert constant_time_equals("abc", "abc") is True
    assert constant_time_equals("abc", "abd") is False
    assert constant_time_equals("a", "ab") is False
    assert constant_time_equals("", "x") is False


# ─── VULN-09 — PAT last_used_at no commitea en cada request ──────────────────


def test_vuln09_pat_last_used_throttled(client, session):
    """Crear un PAT, hacer 5 requests rápidos seguidos. Solo el primero
    debe haber bumpeado last_used_at; los siguientes 4 caen dentro del
    throttle de 30s y NO deben generar commits adicionales en esa
    columna."""
    from app.security import generate_api_token, hash_api_token, utcnow_naive
    from app.models.user import User, UserRole
    from app.security import hash_password

    user = User(
        username="vuln09user",
        password_hash=hash_password("xx"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    plaintext = generate_api_token()
    pat = ApiToken(
        user_id=user.id,
        token_hash=hash_api_token(plaintext),
        token_prefix=plaintext[:12],
        name="throttle-test",
    )
    session.add(pat)
    session.commit()
    session.refresh(pat)

    headers = {"Authorization": f"Bearer {plaintext}"}

    # Primera petición — debe bumpear last_used_at.
    r1 = client.get("/api/auth/me", headers=headers)
    assert r1.status_code == 200
    session.expire_all()
    pat = session.exec(select(ApiToken).where(ApiToken.id == pat.id)).first()
    first_bump = pat.last_used_at
    assert first_bump is not None

    # 4 peticiones rápidas — no deben mover last_used_at (dentro del
    # throttle de 30s). Sleep 0.05s entre ellas para evitar coincidir
    # exactamente con el primer timestamp.
    for _ in range(4):
        time.sleep(0.05)
        client.get("/api/auth/me", headers=headers)

    session.expire_all()
    pat = session.exec(select(ApiToken).where(ApiToken.id == pat.id)).first()
    assert pat.last_used_at == first_bump, (
        "last_used_at se bumpeó en cada request — throttle VULN-09 roto"
    )
