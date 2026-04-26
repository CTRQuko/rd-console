"""Network throughput samples — populated by an internal scheduler.

The Dashboard "Tráfico de red" chart needs a 60-minute window with
1-minute buckets. psutil.net_io_counters() gives a monotonic byte
counter; to derive a rate we need successive samples. We persist them
so a backend restart doesn't blank the chart for the next 60 minutes.

A single sample row is small (~32 bytes), and the cleanup task keeps
only the last 7 days, so the table stays bounded (~10 080 rows max
per window-week × 1-min cadence).
"""

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class SystemMetricSample(SQLModel, table=True):
    __tablename__ = "system_metric_samples"

    id: int | None = Field(default=None, primary_key=True)
    sampled_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    # Cumulative byte counters from psutil — NOT a rate. Rates are derived
    # in the throughput query by diffing consecutive rows.
    bytes_in: int = Field(default=0)
    bytes_out: int = Field(default=0)
