"""In-process rate limiter — keyed by (bucket, client_ip).

Deliberately dependency-free (no Redis, no slowapi). The panel runs as a
single uvicorn process in production; distributed coordination is not
worth the dependency for /api/auth/login and /api/join/:token, the two
public endpoints where this matters.

Algorithm: fixed-window counter.
    For each (bucket, key), we store { window_started_at, count }. When
    a request arrives after `window_seconds` from the window start, we
    reset. Simple, predictable, and avoids the memory churn of sliding-
    window implementations.

Memory safety: the dict is shared process-wide. To keep it from growing
unbounded under a denial-of-service, we opportunistically prune entries
older than 2× the window on every write.

Thread safety: FastAPI's default worker is a single event loop, so the
read-modify-write races we'd see in a threaded server don't apply here.
If we ever switch to multi-threaded workers, wrap the mutations in a
`threading.Lock` — documented in ``check`` below.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import HTTPException, Request, status


@dataclass
class _Entry:
    window_started: float
    count: int


# Keyed by (bucket, ip). Mutated from request handlers only.
_counters: dict[tuple[str, str], _Entry] = {}


def reset_for_tests() -> None:
    """Called from conftest to keep tests hermetic between runs."""
    _counters.clear()


def check(
    *,
    bucket: str,
    key: str,
    limit: int,
    window_seconds: int,
    now: float | None = None,
) -> None:
    """Raise 429 if (bucket, key) has made more than `limit` calls in the
    current `window_seconds` window. Otherwise increments the counter.
    """
    t = now if now is not None else time.monotonic()

    # Opportunistic GC — cheap, bounded, avoids a background task.
    # Removes any entry whose window ended more than 2× window ago; the
    # factor of 2 gives a grace period for still-active attackers whose
    # window just rolled over.
    stale_before = t - 2 * window_seconds
    if len(_counters) > 4096:
        for k, v in list(_counters.items()):
            if v.window_started < stale_before:
                _counters.pop(k, None)

    entry = _counters.get((bucket, key))
    if entry is None or (t - entry.window_started) >= window_seconds:
        _counters[(bucket, key)] = _Entry(window_started=t, count=1)
        return

    if entry.count >= limit:
        # Retry-After hints roughly when the window resets. Integer seconds
        # to stay within the HTTP spec (RFC 9110).
        retry_after = max(1, int(window_seconds - (t - entry.window_started)))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
            headers={"Retry-After": str(retry_after)},
        )

    entry.count += 1


def _client_ip(request: Request) -> str:
    """Best-effort client IP que respeta `RD_TRUSTED_PROXIES`.

    Cierra VULN-01 del audit 2026-05-01: la versión anterior leía
    `X-Forwarded-For` sin validar el origen, y un atacante rotaba el
    header para evadir el limit de 10 logins/min. Ahora delega en
    `services.trusted_ip` que solo honra XFF si la conexión directa
    viene de una red listada en `trusted_proxies` (lista vacía por
    defecto = XFF ignorado).

    `unknown` es el fallback para peticiones sin `request.client`
    (sintéticas, tests) — comparten bucket en lugar de saltarse el limit.
    """
    from .trusted_ip import real_client_ip

    return real_client_ip(request) or "unknown"


def rate_limit_dep(
    *, bucket: str, limit: int, window_seconds: int,
) -> Callable[[Request], None]:
    """Return a FastAPI dependency that enforces the given budget.

    Usage::

        @router.post(
            "/login",
            dependencies=[Depends(rate_limit_dep(
                bucket="login", limit=10, window_seconds=60,
            ))],
        )
        def login(...): ...

    Keeping the dependency factory here (rather than inline `Depends(...)`)
    means the test suite can reset state between tests via
    :func:`reset_for_tests` without having to reach into every router.
    """

    def dependency(request: Request) -> None:
        check(
            bucket=bucket,
            key=_client_ip(request),
            limit=limit,
            window_seconds=window_seconds,
        )

    return dependency
