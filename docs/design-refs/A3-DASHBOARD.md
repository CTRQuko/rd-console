# Sprint A3.dashboard — Data Reference

> Data reconnaissance from spike on 2026-04-24. Target: add historical /
> analytical charts to `frontend/src/pages/DashboardPage.tsx`, which today
> only shows live counts from mock data.

## 1. Data sources on hand

### `backend/app/models/audit_log.py`
`AuditLog` columns:
- `id: int` PK
- `action: AuditAction` enum (24 values: CONNECT, DISCONNECT, FILE_TRANSFER, CLOSE, LOGIN, LOGIN_FAILED, USER_*, DEVICE_*, TAG_*, API_TOKEN_*, ADDRESS_BOOK_*, JOIN_TOKEN_*)
- `from_id: str | None` max 32 (RustDesk ID)
- `to_id: str | None` max 32
- `ip: str | None` max 45
- `uuid: str | None` max 64
- `actor_user_id: int | None` FK→users
- `payload: str | None` free-form JSON
- `created_at: datetime` **indexed**
- `deleted_at: datetime | None` **indexed** (soft delete)

Indexes support `WHERE created_at BETWEEN X AND Y` and `WHERE action = … AND created_at …` efficiently.

### `backend/app/models/device.py`
- `last_seen_at: datetime | None`
- `created_at: datetime` (not indexed today — mayhap add index if charts hit it hot)

### `backend/app/models/user.py`
- `last_login_at: datetime | None`
- `created_at: datetime`

## 2. Current DashboardPage

`frontend/src/pages/DashboardPage.tsx` renders:
- 4 stat cards: `totalUsers`, `onlineDevices`, `totalDevices`, `connectionsToday` (lines 77-132) with a `trend` string each
- A `RecentEntry[]` table of the last 7 events (lines 134-162)

Both come from `mockApi.stats()` / `mockApi.recent()` — **no real backend
endpoint**. `DashboardStats` type is declared in `frontend/src/types/api.ts:52-63`
but not implemented server-side.

## 3. Chart library void

`frontend/package.json` has **no** chart dep today. Sprint A3 must pick
one. Candidates: recharts (React idiomatic), chart.js (mature, canvas),
visx/d3 (low-level). No recommendation here — decide at sprint start.

## 4. Proposed charts (6)

Prioritised for the real use case (personal operator + friends/family
support). Anomaly detection > vanity metrics.

### A. Auth failure timeline (24h, hourly)
- Spikes indicate brute force or credential issues
- Agg: `GROUP BY DATE_TRUNC('hour', created_at)` on `action='login_failed'`
- New endpoint: `/admin/api/stats/auth-failures?since=&until=&granularity=hour`

### B. Device online/offline churn (7d, daily)
- Family devices dropping off unexpectedly = support signal
- Agg over `last_seen_at` + audit DEVICE_FORGOTTEN / DEVICE_DISCONNECT_REQUESTED joins
- New endpoint: `/admin/api/stats/device-churn?days=7`

### C. Connection volume trend (30d, daily)
- Usage baseline; sustained drops = device dead/retired
- Agg: `action='connect' GROUP BY DATE(created_at)`
- New endpoint: `/admin/api/stats/connections?since=&until=&granularity=day`

### D. File-transfer activity (7d, 4h buckets)
- When operator is actively helping vs idle
- Agg on `action='file_transfer'`
- New endpoint: `/admin/api/stats/file-transfers?granularity=4h`

### E. Per-device session duration (30d)
- Long sessions (8h+) = unattended access or stuck connections
- Agg: `LEAD()` window over CONNECT/DISCONNECT pairs per `from_id`
- New endpoint: `/admin/api/stats/session-durations?device_id=&days=30`

### F. Top actors (30d, top 10)
- Who uses the panel/device most → allocate support time
- Agg: `GROUP BY actor_user_id ORDER BY COUNT(*) DESC LIMIT 10`
- New endpoint: `/admin/api/stats/top-actors?days=30&limit=10`

## 5. Volume / performance

Soft-delete retention floor = 30 days (`logs.py:289-293`). Hard-delete cron
is still TODO (`logs.py:81`). So rows accumulate forever unless an admin
explicitly purges.

Steady-state estimate for a home setup (~20 devices, 5 users, 10-50
connections/day): **500-2000 rows/day**, **15K-60K at 30 days**, **180K-730K
at 1 year**. Even 730K rows with a compound index on `(action, created_at,
deleted_at)` stays sub-100ms on SQLite — not a blocker today.

Becomes relevant only if the instance runs 2+ years or supports 100+
devices. Prioritise the hard-delete cron before that inflection point.

## 6. For the implementing sprint

1. Pick chart library + add dep (decision tree: 15 min)
2. Add 6 `/admin/api/stats/*` endpoints with OpenAPI summaries
3. Widen `DashboardPage.tsx` — replace mock `stats()` / `recent()` with
   real queries; add a chart grid below the stat cards
4. i18n: new `dashboard.chart.*` keys in 5 locales
5. Backend tests: one per endpoint checking aggregation math
6. Frontend test: snapshot test per chart with seeded data
