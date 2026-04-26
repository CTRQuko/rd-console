"""Periodic system-metric sampler — feeds the Dashboard throughput chart.

Why persist samples instead of computing on demand:
  * psutil's net_io_counters() returns cumulative bytes since boot, so a
    rate requires *two* samples spaced in time. A single API call can't
    do that without holding state.
  * Holding state in process memory means a backend restart blanks the
    chart for the next 60 minutes. Persisting to SQLite is cheap (~30
    bytes per row, max one row per minute) and survives reloads.

Sample cadence is 60 s. The "Tráfico de red" panel renders 60 buckets,
so a single hour of uptime produces a full curve. Older samples are
purged after `_RETENTION_DAYS` (currently 7) — enough to support a 24h
window if we ever surface one, while keeping the table bounded.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

import psutil
from sqlmodel import Session, delete, select

from .. import db as _db_module
from ..models.system_metric import SystemMetricSample
from ..security import utcnow_naive

log = logging.getLogger("rd_console.metrics_sampler")

# 60 s gives us 60 buckets per hour, matching the chart resolution.
_SAMPLE_INTERVAL_SECONDS = 60
# A week of samples is ~10 080 rows — small enough to leave on disk.
_RETENTION_DAYS = 7
# Purge runs alongside the sample loop; we don't need a separate task.
# Once every ~6 h is plenty given the small table size.
_PURGE_EVERY_N_TICKS = 6 * 60  # 6 h at 60 s per tick


def _capture_sample() -> SystemMetricSample:
    """Snapshot psutil counters into a fresh model instance.

    Cumulative byte values are returned as-is; the throughput query
    derives rates by diffing consecutive rows.
    """
    counters = psutil.net_io_counters()
    return SystemMetricSample(
        sampled_at=utcnow_naive(),
        bytes_in=counters.bytes_recv,
        bytes_out=counters.bytes_sent,
    )


async def _sample_once() -> None:
    """One sample insert. Swallows DB errors so the loop never dies."""
    sample = await asyncio.to_thread(_capture_sample)
    try:
        with Session(_db_module.engine) as session:
            session.add(sample)
            session.commit()
    except Exception:  # noqa: BLE001 - background task must never crash
        log.exception("metrics_sampler: failed to persist sample")


async def _purge_old() -> int:
    """Delete samples older than _RETENTION_DAYS. Returns row count."""
    cutoff = utcnow_naive() - timedelta(days=_RETENTION_DAYS)
    try:
        with Session(_db_module.engine) as session:
            result = session.exec(
                delete(SystemMetricSample).where(SystemMetricSample.sampled_at < cutoff)
            )
            session.commit()
            count = result.rowcount if result.rowcount and result.rowcount > 0 else 0
        if count:
            log.info("metrics_sampler: purged %d old samples (>%dd)", count, _RETENTION_DAYS)
        return count
    except Exception:  # noqa: BLE001
        log.exception("metrics_sampler: purge failed")
        return 0


async def run_sampler_loop() -> None:
    """Background loop: sample → wait → repeat. Periodically purges old rows."""
    log.info("metrics_sampler: starting (interval=%ds, retention=%dd)",
             _SAMPLE_INTERVAL_SECONDS, _RETENTION_DAYS)
    tick = 0
    while True:
        try:
            await _sample_once()
            tick += 1
            if tick % _PURGE_EVERY_N_TICKS == 0:
                await _purge_old()
        except Exception:  # noqa: BLE001
            log.exception("metrics_sampler: tick failed")
        await asyncio.sleep(_SAMPLE_INTERVAL_SECONDS)
