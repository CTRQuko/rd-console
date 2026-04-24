# rd-console — Roadmap

> Last updated: 2026-04-24
> Current shipped version: **v10-last-seen** (honest tier-based presence badge).
> Branch tip: `feat/last-seen-refactor` → PR #45.

This document is the plan of record for where rd-console goes next. It
reflects the product stance after the v10 refactor made it explicit that
real-time per-peer presence is structurally impossible on `rustdesk-server`
free (see `docs/servicios/rustdesk-lxc-105/online-detection-limitation.md`
in the homelab docs repo for the evidence).

Use case under the hood: **personal operator + occasional remote support
for friends/family**. Any work item that doesn't pay rent against that use
case should be dropped, not deferred.

---

## Phase 0 — Shipped (reference)

| Area | What landed |
|---|---|
| Auth | JWT w/ `jti` deny-list, PATs, bootstrap admin protection |
| Devices | List / edit / disable / delete / panel-side disconnect, tags, favourites, notes, bulk ops, v10 tier badge |
| Users | CRUD + bulk (disable/enable/delete), hard-delete w/ cascade |
| Audit log | CONNECT/DISCONNECT differentiated, filters, CSV/NDJSON export, soft delete, 30d retention |
| Address Book | `POST /api/ab` — Flutter client compatible |
| Heartbeat | `/api/heartbeat` + hbbs-watcher systemd sidecar |
| Health | `/admin/api/health/hbbs` endpoint + UI button |
| Settings | Runtime-editable server config, security, appearance, API tokens |
| i18n | es/en/pt/fr/de (5 locales) |
| Infra | LXC 105 single-host, non-default ports 45115-45119, fail2ban, Cloudflare → UniFi → Digi WAN |

## Explicit out-of-scope (free tier upstream limits)

- Real-time per-peer presence
- Force-disconnect of an active hbbr session
- Visibility into currently-connected peer pairs
- Remote client commands (reboot, restart client)
- Panel-driven IP banning

Not revisited unless upstream changes or scope grows dramatically. Paid Pro
and UDP-sniffer sidecars are both explicitly declined.

---

## Phase A — Short-term · Stabilise + Observability

Two blocks, independent, can run in parallel. Phase A closes tech debt on
what already ships and opens the product to the outside world without
touching the user/role model.

### A1 — Stabilise (**first sprint when work resumes**)

| Item | Rationale | Size |
|---|---|---|
| Polished OpenAPI docs | FastAPI auto-generates the spec. Clean up descriptions, tags, examples, expose `/docs` (admin-gated or public). | S |
| Backup/restore endpoints | `GET /admin/api/export` → JSON (users, tags, settings, tokens metadata — **no secrets, no passwords**). `POST /admin/api/import` reimports. UI button in Settings → Advanced. Unblocks VLAN migration and DR. | M |
| Empty states + onboarding hints | Empty `DevicesPage` / `UsersPage` / `JoinTokensPage` → show a "here's how to get started" card with the actual CTA. | S |
| E2E smoke tests (Playwright) | 5-7 critical flows against a real LXC 105 deploy: login, create/accept invite, bulk device delete, revoke PAT, admin forgotten-password. No more — don't drown in E2E. | M |
| Consolidate legacy date helpers | Follow-up from v10: audit `LogsPage`, `UsersPage`, any other local relativisation helpers; move all to `lib/formatters.tsx`. | S |

**Done-when:** all five items shipped, tests green, PR merged, deployed to LXC 105.

### A3 — Observability + alerts

| Item | Rationale | Size |
|---|---|---|
| Analytical Dashboard | `DashboardPage` gains time-series charts over audit log: registrations/hour (24h window), IP changes/week, top-10 peers by audit activity, platform distribution pie. Recharts or hand-rolled SVG. | M |
| Outbound webhooks | New table `webhook_endpoint(id, url, secret, events[], enabled, last_delivery_at, last_status)`. Background worker POSTs HMAC-signed (`X-RDC-Signature: sha256=…`) payloads with exponential backoff. Events: `device.registered`, `device.ip_changed`, `device.forgotten`, `user.created`, `audit.anomaly`. Settings → Webhooks tab shows delivery history. | L |
| Notification channels | Internal webhook consumers that forward to Telegram (bot API), Discord (incoming webhook URL), Email (SMTP). Each event configurable to any combination. | M |
| Prometheus `/metrics` | Exposed on `/admin/api/metrics` (bearer) or separate `:9090` localhost-only. Metrics: `rdc_devices_total`, `rdc_users_total`, `rdc_heartbeats_total`, `rdc_auth_failures_total`, `rdc_audit_events_total{action}`, request latency histogram. | M |
| Anomaly detection job | Background task detects: peer with > 3 IP changes/hour, > N auth failures from one IP, device dormant > 30d (cleanup candidate). Emits `audit.anomaly` → fanned out via the webhook + notification stack above. | M |

**Done-when:** dashboard renders charts with real data; webhooks deliver to at least Telegram and Discord; Prometheus scrape succeeds; anomaly job fires on a synthetic trigger.

---

## Phase B — Mid-term · Security + real multi-user

Requires schema migration and a product mindset shift (admin-only
single-tenant → multi-operator). Don't start until Phase A is stable in
production for a couple of weeks.

| Item | Rationale | Size |
|---|---|---|
| 2FA (TOTP + backup codes) | `pyotp`-based, per-user `totp_secret` + `totp_verified`. Enrollment QR + 10 one-time backup codes. Admin-configurable enforcement per role. | M |
| Granular roles | New `manager` role: sees/edits devices within its org only. `viewer` read-only. `admin` superuser. Migration preserves existing admins. | L |
| Organizations + per-device ACL | New `organization` table. `user.org_id`, `device.org_id`. Managers are scoped to their org; devices without org are admin-only global. Invites carry a default org. Unblocks giving friends/family a cordoned account. | L |
| Session management | UI lists active JWTs (computable from mint log minus `jti` deny-list), admin can revoke any session. | S |
| Rate limiting | `slowapi` or custom middleware. Login: 5/min/IP. Heartbeat: 30/min/IP. Admin endpoints: 100/min/user. Return 429 with `Retry-After`. | S |
| Admin IP allowlist | `settings.admin_ip_allowlist` (CIDR list). Admin login from outside → 403 before password check. Defence-in-depth for the public FQDN. | S |
| Admin view-audit (optional) | Log what admins *viewed*, not only what they *changed*. Doubles audit volume; only if a real need surfaces. | M |

**Done-when:** fresh friend account can be created, receives invite for its own org, sees only its own devices; 2FA enforced for admin; rate-limiter shown working via pytest.

---

## Phase C — Long-term / optional · PWA + QoL

Only if motivation is there after Phase B. Nothing in here is critical.

- PWA manifest + service worker (installable on iOS/Android/desktop).
- Offline cache for devices list + recent audit.
- Web push notifications (VAPID); hooks into A3 webhook event bus.
- Keyboard shortcuts overlay (`?` opens cheatsheet).
- Command palette v2: fuzzy search, grouped results, action support.
- Bulk edit tags across N devices.
- First-run tag presets ("Home", "Work", "Workshop", "Friends").

---

## Suggested sprint sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│  Sprint 1 — A1 Stabilise                                   (STARTS) │
│  Sprint 2 — A3 Dashboard + Prometheus metrics                       │
│  Sprint 3 — A3 Webhooks + Telegram notifications                    │
│  Sprint 4 — A3 Anomaly detection   → closes Phase A                 │
├─────────────────────────────────────────────────────────────────────┤
│  (gap: use the panel in prod for a few days; validate assumptions)  │
├─────────────────────────────────────────────────────────────────────┤
│  Sprint 5 — B 2FA + rate-limiting  (quick wins)                     │
│  Sprint 6 — B roles + orgs + per-device ACL  (the big one)          │
│  Sprint 7 — B session-mgmt + IP allowlist + admin audit (polish)    │
├─────────────────────────────────────────────────────────────────────┤
│  (re-evaluate: ship Phase C, or freeze and just maintain)           │
└─────────────────────────────────────────────────────────────────────┘
```

**One sprint ≈ one focused session of planning + implementation + deploy.**
There is no external deadline. Cadence is "when Jandro feels like it."

---

## Non-goals on purpose

- **No sniffer/UDP keepalive proxy.** Rejected by Jandro: complexity + network load.
- **No hbbs Pro upgrade.** Rejected by Jandro: personal use doesn't justify the cost.
- **No remote control of clients (reboot/restart).** Protocol doesn't support it.
- **No Postgres migration.** SQLite is fine at this scale; re-evaluate only if sharing across hosts.

---

## How to resume work

When starting a sprint:
1. Read this ROADMAP + the relevant section.
2. Use `/plan` (or equivalent) to turn the section into a concrete plan file.
3. Land it in its own feature branch stacked on `main`.
4. Deploy using the pipeline documented in `docs/servicios/rustdesk-lxc-105/`
   (mac-mini temp build → `docker save | gzip` → pct exec tee → docker load → swap).
5. Tick the item off here in the same PR.
