"""Resolve the real client IP, respecting `RD_TRUSTED_PROXIES`.

Cierra VULN-01 (rate-limit del login bypass-eable vía X-Forwarded-For) y
VULN-10 (IP del audit log spoofable) del audit 2026-05-01.

Política:
- Por defecto (lista vacía): se ignora `X-Forwarded-For` por completo y
  se usa la IP del socket directo (`request.client.host`). Esto evita
  que un cliente externo invente la IP que usaremos para indexar rate
  limits, audit logs o session tracking.
- Si la conexión directa viene de una IP listada en `trusted_proxies`,
  entonces SÍ honramos `X-Forwarded-For` y devolvemos el primer hop
  (cliente original detrás del proxy).

`trusted_proxies` admite IPs literales (`"10.0.0.1"`) y redes CIDR
(`"10.0.0.0/8"`, `"::1/128"`). Implementado con `ipaddress` stdlib —
sin dependencias nuevas.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from fastapi import Request

from ..config import get_settings


@lru_cache(maxsize=1)
def _parse_trusted() -> tuple[
    tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...],
    frozenset[str],
]:
    """Parse `trusted_proxies` en dos buckets:
    - networks: entradas que son IPs/CIDRs válidos (IPv4/IPv6)
    - literals: cualquier otra string (p.e. ``"testclient"`` que usan
      los TestClient de Starlette como `request.client.host`).

    Esto permite que los tests trusten al cliente sintético sin un IP
    real, sin bajar la guardia en producción donde solo IPs reales
    aparecen en el bucket literal.
    """
    settings = get_settings()
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    literals: set[str] = set()
    for entry in settings.trusted_proxies:
        if not isinstance(entry, str) or not entry:
            continue
        try:
            nets.append(ipaddress.ip_network(entry, strict=False))
        except (ValueError, TypeError):
            literals.add(entry)
    return tuple(nets), frozenset(literals)


def _is_trusted_proxy(direct_ip: str) -> bool:
    nets, literals = _parse_trusted()
    if direct_ip in literals:
        return True
    if not nets:
        return False
    try:
        addr = ipaddress.ip_address(direct_ip)
    except (ValueError, TypeError):
        return False
    return any(addr in n for n in nets)


def real_client_ip(request: Request, *, max_len: int = 45) -> str | None:
    """Return the best-effort client IP for indexing/logging.

    Returns:
        The first hop of `X-Forwarded-For` if the direct connection is
        from a trusted proxy, otherwise the direct socket IP. None if
        no IP is available at all (rare; usually only in tests with a
        synthetic request).

    The result is truncated to `max_len` chars (45 = max IPv6 string
    length) to bound the size of dict keys / DB columns.
    """
    direct_ip = request.client.host if request.client else None
    if direct_ip and _is_trusted_proxy(direct_ip):
        xff = request.headers.get("x-forwarded-for", "")
        first = xff.split(",")[0].strip() if xff else ""
        if first:
            return first[:max_len]
    return direct_ip[:max_len] if direct_ip else None


def reset_cache_for_tests() -> None:
    """Clear the parsed-trust cache so tests can flip
    `RD_TRUSTED_PROXIES` between cases."""
    _parse_trusted.cache_clear()
