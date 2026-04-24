# Sprint A3.webhooks — Design Reference

> Produced by a design spike on 2026-04-24. The next sprint executes against
> this doc; the architecture is concrete enough that no further review is
> required before coding starts.

## 1. `WebhookEndpoint` SQLModel

File: `backend/app/models/webhook_endpoint.py`

Columns:
- `id: int | None` PK
- `created_by_user_id: int | None` FK→users (indexed, soft cascade if user deleted)
- `label: str` max 128
- `target_url: str` max 2048 (HTTPS validated at creation in prod)
- `secret: str` max 64 — **plaintext at rest** (unlike ApiToken; user needs to copy it externally). 32 bytes urlsafe-base64. Rotation = new endpoint.
- `events: str` max 512 — comma-separated event types OR `"*"`. Validated against `ALLOWED_EVENTS` in router.
- `is_active: bool` default True (indexed)
- `last_delivered_at: datetime | None`
- `last_attempt_at: datetime | None`
- `consecutive_failures: int` 0-100, reset on success
- `created_at`, `updated_at`, `deleted_at: datetime | None` (soft delete, indexed)

Helper: `_gen_webhook_secret() -> str` using `secrets.token_urlsafe(32)`.

## 2. Event contract

8 event types: `device.registered`, `device.forgotten`, `device.ip_changed`,
`device.updated`, `user.created`, `user.deleted`, `audit.anomaly`,
`webhook.delivery_failed` (internal, never emitted to user endpoints).

Envelope shape (all events):
```json
{
  "event_type": "device.registered",
  "timestamp": "2026-04-24T12:34:56.789Z",
  "webhook_id": 5,
  "sequence": 42,
  "payload": { /* event-specific */ }
}
```

Payload schemas (examples in original spike transcript; essentially the
snake_case API shape for the relevant entity + `actor_user_id` when a
human triggered it).

## 3. HMAC signature

- Header: `X-Webhook-Signature: sha256=<hex>`
- Canonical signed string: `<timestamp>\n<body-bytes>`
- Constant-time compare with `hmac.compare_digest`
- Replay window: reject if `timestamp` older than 5 min (env var `RD_WEBHOOK_REPLAY_WINDOW_SECONDS`, default 300)
- Recipient also tracks seen `(webhook_id, sequence)` for exact-replay defence

## 4. Retry + dead-letter

- Exponential backoff with jitter: 0s → 5s → 25s → 2m → 10m → 10m × 5
- Max 10 attempts (env `RD_WEBHOOK_MAX_ATTEMPTS`)
- Total budget ~30 min
- After attempt 10 → move to `WebhookDeadLetter` table, emit
  `AuditLog(action=WEBHOOK_DELIVERY_FAILED)` with the endpoint id + last error
- UI "redeliver" button: `POST /admin/api/webhooks/{id}/redeliver/{dl_id}`

Additional tables:
- `WebhookDeadLetter` — persistent failures for operator review
- `WebhookDeliveryQueue` — transient, cleared after success; holds
  `attempt_count` and `next_retry_at` for the background worker

## 5. File layout

| Path | Contents |
|---|---|
| `backend/app/models/webhook_endpoint.py` | 3 SQLModels above |
| `backend/app/routers/webhooks.py` | CRUD + deliveries + dead-letters + redeliver (8 endpoints under `/admin/api/webhooks`) |
| `backend/app/services/webhook_dispatcher.py` | `emit_webhook_event()` fire-and-forget helper + `run_webhook_delivery_loop()` background task |
| `backend/app/main.py` | lifespan starts `webhook_dispatcher` task alongside `hbbs_sync` and `jwt_cleanup` |
| `frontend/src/hooks/useWebhooks.ts` | list / create / update / delete / deliveries / dead-letters / redeliver |
| `frontend/src/pages/settings/SettingsWebhooksTab.tsx` | CRUD UI with copy-secret-once flow, dead-letter pane, redeliver button |

Emission pattern (from existing routers):
```python
session.add(Device(...)); session.commit()
emit_webhook_event("device.registered", {...payload...}, session)
```
which enqueues a row in `WebhookDeliveryQueue`.

## 6. Security / risks

- **SSRF**: block RFC1918 / loopback / link-local at endpoint-create time.
  Env `RD_WEBHOOK_ALLOW_PRIVATE_URLS=false` by default. Set `true` for
  homelab use if internal webhook targets needed.
- **Mail bomb on recovery**: 10 attempts over 30 min caps it; dead-letter
  queue catches overflow.
- **Circular webhooks**: reject user endpoints subscribing to
  `webhook.*` event types.
- **Log hygiene**: never log the secret or full signature; log
  `[webhook_id=5, status=200]` only.
- **Dead-letter retention**: 90 days default (`RD_WEBHOOK_DEAD_LETTER_RETENTION_DAYS`).

## 7. Non-goals

- Inbound webhooks (receiving FROM external systems)
- Per-event custom templating
- Complex routing rules (tag matchers, etc.)
- Panel verifying its own emitted signatures (that's recipient's job)

## 8. Execution checklist for the sprint

1. Models + migration (2-3 days)
2. Router + CRUD with OpenAPI summaries (2-3 days)
3. Dispatcher + delivery loop + HMAC (3-4 days)
4. Event emission from routers: devices, users (2-3 days)
5. Frontend hooks + Settings → Webhooks tab (2-3 days)
6. Env vars documentation + OpenAPI tag registration + tests (1-2 days)

Total 12-18 days, one sprint with a parallel feature.
