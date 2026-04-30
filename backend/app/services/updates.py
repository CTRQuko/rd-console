"""Check the latest released version on GitHub.

Used by the Settings → Updates panel. Does NOT auto-update anything —
it just tells the operator whether a newer release is available so
they can pull it manually.

Implementation notes:
  * Uses urllib (stdlib) to avoid pulling httpx into the runtime path
    just for one infrequent GET. The check happens at most once per
    hour (`_CACHE_TTL_SECONDS`) and on demand via the `force=True`
    flag, so synchronous I/O is acceptable.
  * GitHub anonymous rate limit is 60/h per IP — well above what one
    panel instance can spend.
  * On any error (network, timeout, malformed JSON) we return the
    last known cache + an `error` field; the panel renders that
    instead of pretending we're up-to-date.
"""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from .. import __version__
from ..security import utcnow_naive

log = logging.getLogger("rd_console.updates")

GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/CTRQuko/rd-console/releases/latest"
_CACHE_TTL_SECONDS = 60 * 60  # 1 h
_REQUEST_TIMEOUT_SECONDS = 6.0


@dataclass
class UpdateStatus:
    current_version: str
    latest_version: str | None
    update_available: bool
    latest_url: str | None
    latest_published_at: str | None
    last_checked_at: str
    error: str | None = None


_lock = threading.Lock()
_cached: UpdateStatus | None = None


def _strip_v(tag: str | None) -> str | None:
    """Normalise GitHub release tags ("v1.2.3" → "1.2.3") so the comparison
    matches our `__version__` literal."""
    if not tag:
        return None
    return tag.lstrip("vV") if tag.startswith(("v", "V")) else tag


def _is_newer(remote: str | None, local: str) -> bool:
    """Lexicographic-by-tuple comparison after extracting the numeric
    SemVer prefix from each tag. Tags like "0.3.0-ab" or "1.2.3-rc1"
    compare on the (0, 3, 0) / (1, 2, 3) prefix, ignoring the suffix.

    Anything that doesn't yield at least one numeric segment is treated
    as equal — no pestering the operator with bogus update prompts.
    """
    if not remote:
        return False
    import re
    pattern = re.compile(r"^(\d+(?:\.\d+){0,2})")
    rm = pattern.match(remote)
    lm = pattern.match(local)
    if not rm or not lm:
        return False
    try:
        a = tuple(int(x) for x in rm.group(1).split("."))
        b = tuple(int(x) for x in lm.group(1).split("."))
        return a > b
    except (ValueError, AttributeError):
        return False


def _fetch_github() -> UpdateStatus:
    """Perform the HTTP GET. Always returns a populated UpdateStatus —
    on failure, `error` is set and the version fields are best-effort."""
    now_iso = utcnow_naive().isoformat()
    req = urllib.request.Request(
        GITHUB_LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"rd-console/{__version__}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        log.info("update check failed: %s", exc)
        return UpdateStatus(
            current_version=__version__,
            latest_version=None,
            update_available=False,
            latest_url=None,
            latest_published_at=None,
            last_checked_at=now_iso,
            error=str(exc),
        )

    tag_name = payload.get("tag_name")
    latest = _strip_v(tag_name)
    return UpdateStatus(
        current_version=__version__,
        latest_version=latest,
        update_available=_is_newer(latest, __version__),
        latest_url=payload.get("html_url"),
        latest_published_at=payload.get("published_at"),
        last_checked_at=now_iso,
        error=None,
    )


def get_status(*, force: bool = False) -> UpdateStatus:
    """Public API — return the current cached status, refreshing on miss
    or when the caller asks for it. Thread-safe so multiple admin tabs
    hitting the endpoint at once don't all stampede GitHub."""
    global _cached
    with _lock:
        if not force and _cached is not None:
            try:
                last = datetime.fromisoformat(_cached.last_checked_at)
                if utcnow_naive() - last < timedelta(seconds=_CACHE_TTL_SECONDS):
                    return _cached
            except ValueError:
                pass
        fresh = _fetch_github()
        _cached = fresh
        return fresh


def status_to_dict(s: UpdateStatus) -> dict:
    return asdict(s)
