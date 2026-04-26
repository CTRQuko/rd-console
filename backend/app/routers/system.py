"""System metrics + recent connections — feeds the redesigned Dashboard.

Implements the contract documented in the comment header of
`frontend/public/console/pages/Dashboard.jsx` (lines 7-49) and
`backend/BACKEND.md` §2.

All endpoints sit under the new `/api/v1` namespace declared by the
design ZIP. They live alongside the legacy `/api/...` and `/admin/api/...`
routes — no migration of older endpoints is implied by adding this router.

Polling cadence (driven by the frontend, NOT enforced server-side):
- /system/metrics              — every 5 s (live metrics)
- /system/connections-24h      — every 60 s (histogram)
- /system/throughput           — every 5 s (chart)
- /system/uptime               — every 60 s (sparkline)
- /connections/recent          — every 10 s (table)
"""

from __future__ import annotations

import platform
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

import psutil
from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from ..deps import AdminUser, SessionDep
from ..models.audit_log import AuditAction, AuditLog
from ..models.device import Device
from ..security import utcnow_naive

router = APIRouter(prefix="/api/v1", tags=["system"])

# ─── Helpers ──────────────────────────────────────────────────────────────

# Cache CPU model + cores at module load — they don't change at runtime
# and `cpu_freq()` is mildly expensive on Windows.
_CPU_CORES: int = psutil.cpu_count(logical=True) or 1
try:
    _freq = psutil.cpu_freq()
    _CPU_GHZ: float = round((_freq.max or _freq.current or 0) / 1000.0, 2)
except Exception:
    _CPU_GHZ = 0.0
_CPU_MODEL: str = platform.processor() or platform.machine() or "unknown"


# Bandwidth sampler: psutil.net_io_counters() returns lifetime byte counts.
# We diff two samples to get a rate (bps). The first call after process
# start can't compute a rate, so we return 0 and seed the cache.
_last_net_sample: tuple[float, int] | None = None
_last_per_minute: list[int] = []  # rolling 60 samples for the throughput chart


def _sample_bandwidth_bps() -> int:
    """Bytes-per-second total (in+out) since the last call. Returns 0
    on the first call (no baseline yet)."""
    global _last_net_sample
    counters = psutil.net_io_counters()
    total = counters.bytes_sent + counters.bytes_recv
    now = time.monotonic()
    if _last_net_sample is None:
        _last_net_sample = (now, total)
        return 0
    prev_t, prev_total = _last_net_sample
    elapsed = max(0.001, now - prev_t)
    rate_bps = int((total - prev_total) * 8 / elapsed)
    _last_net_sample = (now, total)
    return max(0, rate_bps)


def _online_session_count(session) -> int:
    """Active sessions ≈ devices seen in the last 15 minutes — same window
    `routers/devices.py` uses to colour-code the OnlineBadge."""
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    rows = session.exec(select(Device).where(Device.last_seen_at >= cutoff)).all()
    return len(rows)


# ─── Schemas ──────────────────────────────────────────────────────────────


class CpuMetrics(BaseModel):
    pct: float
    load1: float
    load5: float
    load15: float
    cores: int
    ghz: float
    model: str


class MemoryMetrics(BaseModel):
    pct: float
    used_bytes: int
    free_bytes: int
    total_bytes: int


class SystemMetricsResponse(BaseModel):
    cpu: CpuMetrics
    memory: MemoryMetrics
    sessions_active: int
    bandwidth_bps: int
    bandwidth_delta_pct_vs_prev_hour: float


class Connections24hResponse(BaseModel):
    buckets: list[int]


class ThroughputResponse(BaseModel):
    # `in` is a Python keyword — store as `inbound` and serialise as "in".
    model_config = ConfigDict(populate_by_name=True)

    inbound: list[int] = Field(alias="in")
    out: list[int]
    max_bps: int
    link_capacity_bps: int


class UptimeResponse(BaseModel):
    series: list[float]


class RecentConnection(BaseModel):
    # `from` is also a Python keyword.
    model_config = ConfigDict(populate_by_name=True)

    from_field: str = Field(default="", alias="from")
    to: str = ""
    action: str
    ts: datetime
    ip: str | None = None


class RecentConnectionsResponse(BaseModel):
    rows: list[RecentConnection]


# ─── Endpoints ────────────────────────────────────────────────────────────


@router.get(
    "/system/metrics",
    response_model=SystemMetricsResponse,
    summary="Live host metrics for the Dashboard top row (5s polling)",
)
def system_metrics(session: SessionDep, admin: AdminUser) -> SystemMetricsResponse:
    """CPU pct + loadavg, RAM usage, active sessions, current bandwidth.

    Numbers come straight from psutil. Sessions count = devices with
    `last_seen_at` in the last 15 min (same window used by the device
    OnlineBadge tier).
    """
    # cpu_percent(interval=None) compares to the previous call. The first
    # call returns 0.0; subsequent calls reflect real usage. The 5s polling
    # cadence on the frontend means subsequent calls are accurate.
    cpu_pct = psutil.cpu_percent(interval=None)
    try:
        load1, load5, load15 = psutil.getloadavg()
    except (AttributeError, OSError):
        # getloadavg is Unix-only; on Windows psutil emulates it but may
        # raise on first call before its smoothing kicks in.
        load1 = load5 = load15 = 0.0

    mem = psutil.virtual_memory()

    return SystemMetricsResponse(
        cpu=CpuMetrics(
            pct=round(float(cpu_pct), 1),
            load1=round(float(load1), 2),
            load5=round(float(load5), 2),
            load15=round(float(load15), 2),
            cores=_CPU_CORES,
            ghz=_CPU_GHZ,
            model=_CPU_MODEL,
        ),
        memory=MemoryMetrics(
            pct=round(float(mem.percent), 1),
            used_bytes=int(mem.used),
            free_bytes=int(mem.available),
            total_bytes=int(mem.total),
        ),
        sessions_active=_online_session_count(session),
        bandwidth_bps=_sample_bandwidth_bps(),
        # TODO: requires hour-bucketed aggregate of historical bandwidth.
        # Stub at 0 until we add a background sampler with persistence.
        bandwidth_delta_pct_vs_prev_hour=0.0,
    )


@router.get(
    "/system/connections-24h",
    response_model=Connections24hResponse,
    summary="24-hour connection histogram (60s polling)",
)
def system_connections_24h(
    session: SessionDep, admin: AdminUser
) -> Connections24hResponse:
    """Hourly count of CONNECT events over the last 24 hours, indexed by
    UTC hour-of-day (`buckets[0]` = 00:00 UTC). Empty hours backfill to 0.
    """
    cutoff = datetime.utcnow() - timedelta(hours=24)
    rows = session.exec(
        select(AuditLog.created_at).where(
            AuditLog.action == AuditAction.CONNECT,
            AuditLog.created_at >= cutoff,
            AuditLog.deleted_at.is_(None),  # type: ignore[union-attr]
        )
    ).all()

    counts: Counter[int] = Counter()
    for ts in rows:
        # ts is naive UTC per security.utcnow_naive() convention.
        counts[ts.hour] += 1
    return Connections24hResponse(buckets=[counts.get(h, 0) for h in range(24)])


@router.get(
    "/system/throughput",
    response_model=ThroughputResponse,
    response_model_by_alias=True,
    summary="In/out network throughput over the last 60 minutes (5s polling)",
)
def system_throughput(
    admin: AdminUser,
    session: SessionDep,
    window: str = Query(default="60m", pattern=r"^\d+[ms]$"),
) -> ThroughputResponse:
    """Per-minute in/out byte rates over a sliding window (default 60m).

    Reads from `system_metric_samples` which the metrics-sampler task
    populates every 60 s with cumulative net_io_counters. We diff
    consecutive samples to derive a bytes-per-second rate and bucket
    those rates by minute.

    If the sampler has had less than `num_buckets` minutes to run, the
    leading buckets fill with zeros so the chart still renders.
    """
    from ..models.system_metric import SystemMetricSample

    # Parse the window: "60m" → 3600 s, "30s" → 30 s. The route's regex
    # already validates the shape; here we only worry about unit math.
    raw = window.strip()
    unit = raw[-1]
    value = int(raw[:-1])
    window_seconds = value * (60 if unit == "m" else 1)
    bucket_seconds = 60
    num_buckets = max(1, window_seconds // bucket_seconds)

    now = utcnow_naive()
    cutoff = now - timedelta(seconds=window_seconds + bucket_seconds)
    samples = session.exec(
        select(SystemMetricSample)
        .where(SystemMetricSample.sampled_at >= cutoff)
        .order_by(SystemMetricSample.sampled_at.asc())
    ).all()

    # Pre-fill every bucket with zero so a backend that just started
    # still serves a 60-element array — the chart renders an empty
    # leading region instead of choking on a short series.
    buckets_in = [0] * num_buckets
    buckets_out = [0] * num_buckets

    if len(samples) >= 2:
        # Walk consecutive sample pairs, compute rate, assign to the
        # bucket containing the *later* sample. Using the later sample
        # places "fresh" rates closest to the right edge of the chart,
        # matching what a viewer expects for "now".
        for prev, curr in zip(samples, samples[1:]):
            elapsed = (curr.sampled_at - prev.sampled_at).total_seconds()
            if elapsed <= 0:
                continue  # clock skew or duplicate samples; skip
            rate_in = max(0, (curr.bytes_in - prev.bytes_in) // elapsed)
            rate_out = max(0, (curr.bytes_out - prev.bytes_out) // elapsed)
            # Index = how many full minutes ago this sample was taken,
            # measured from the right edge.
            seconds_ago = (now - curr.sampled_at).total_seconds()
            bucket_idx = num_buckets - 1 - int(seconds_ago // bucket_seconds)
            if 0 <= bucket_idx < num_buckets:
                # If two pairs land in the same bucket (sampler ticked
                # twice that minute), keep the later/larger rate so the
                # chart isn't smoothed away by averaging.
                buckets_in[bucket_idx] = max(buckets_in[bucket_idx], int(rate_in))
                buckets_out[bucket_idx] = max(buckets_out[bucket_idx], int(rate_out))

    max_bps = max([1, *buckets_in, *buckets_out])
    return ThroughputResponse(
        inbound=buckets_in,
        out=buckets_out,
        max_bps=max_bps,
        link_capacity_bps=1_000_000_000,  # assume 1 Gb/s; configurable later
    )


@router.get(
    "/system/uptime",
    response_model=UptimeResponse,
    summary="Daily uptime % over the last N days (60s polling)",
)
def system_uptime(
    admin: AdminUser,
    days: int = Query(default=30, ge=1, le=365),
) -> UptimeResponse:
    """Rolling daily uptime percentages.

    NOTE: This is a stub returning 100.0 for every day until the panel
    persists synthetic-check / heartbeat-probe results. The frontend
    sparkline already handles "all-OK" gracefully.
    """
    # TODO: compute from heartbeat probes / synthetic checks once the
    # backend has somewhere to record them.
    return UptimeResponse(series=[100.0] * days)


@router.get(
    "/connections/recent",
    response_model=RecentConnectionsResponse,
    response_model_by_alias=True,
    summary="Most recent client-relay events (10s polling)",
)
def connections_recent(
    session: SessionDep,
    admin: AdminUser,
    limit: int = Query(default=20, ge=1, le=100),
) -> RecentConnectionsResponse:
    """The last N CONNECT/DISCONNECT/FILE_TRANSFER/CLOSE events.

    Mirrors the shape the design's RecentConnections card expects:
    `{rows: [{from, to, action, ts, ip}]}`.
    """
    session_actions = (
        AuditAction.CONNECT,
        AuditAction.FILE_TRANSFER,
        AuditAction.DISCONNECT,
        AuditAction.CLOSE,
    )
    rows = session.exec(
        select(AuditLog)
        .where(
            AuditLog.action.in_(session_actions),  # type: ignore[union-attr]
            AuditLog.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        .order_by(AuditLog.created_at.desc())  # type: ignore[union-attr]
        .limit(limit)
    ).all()

    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "from": r.from_id or "",
                "to": r.to_id or "",
                "action": r.action.value if hasattr(r.action, "value") else str(r.action),
                "ts": r.created_at.replace(tzinfo=timezone.utc),
                "ip": r.ip,
            }
        )
    return RecentConnectionsResponse(rows=[RecentConnection.model_validate(x) for x in out])
