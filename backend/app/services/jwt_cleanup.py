"""Background cleanup for the JWT revocation list.

Once a revoked token's natural `exp` has passed, the row in
`jwt_revocations` contributes nothing — the JWT is already rejected by
`decode_access_token` on the `exp` check. Keeping the row around just
grows the table forever.

This module exposes:

  * `purge_expired_revocations()` — coroutine that deletes rows whose
    `expires_at` is in the past. Returns the count of rows removed.
  * `run_cleanup_loop()` — long-lived coroutine registered in the app
    lifespan. Runs `purge_expired_revocations()` every ~6 hours with
    exception guards so one bad tick never kills the task.

Interval is deliberately coarse: purge is strictly housekeeping, not
load-bearing. A slow drift into the past costs disk, never security.
"""

from __future__ import annotations

import asyncio
import logging

from sqlmodel import Session, delete

from .. import db as _db_module
from ..models.jwt_revocation import JwtRevocation
from ..security import utcnow_naive

log = logging.getLogger("rd_console.jwt_cleanup")

# Six hours matches how often the hbbs-sync tick feels "active enough"
# without being chatty. Override possible via env in a later sprint if
# an operator needs faster churn.
_CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60


async def purge_expired_revocations() -> int:
    """Drop rows whose expires_at is in the past. Returns the row count.

    Looks up the engine at call time rather than import time so test
    fixtures that swap `db.engine` for an in-memory SQLite get honoured.
    """
    now = utcnow_naive()
    with Session(_db_module.engine) as session:
        result = session.exec(
            delete(JwtRevocation).where(JwtRevocation.expires_at <= now)
        )
        session.commit()
        # SQLAlchemy's rowcount works cleanly on DELETE; if the driver
        # returns -1 we fall back to 0 rather than leaking a weird value
        # into the logs.
        count = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else 0
    if count:
        log.info("jwt_cleanup: purged %d expired revocations", count)
    return count


async def run_cleanup_loop() -> None:
    """Register in app.main.lifespan alongside the hbbs-sync task."""
    while True:
        try:
            await purge_expired_revocations()
        except Exception:  # noqa: BLE001 - background loop; never crash
            log.exception("jwt_cleanup tick failed")
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
