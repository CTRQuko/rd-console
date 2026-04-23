---
title: rd-console v6 changelog
date: 2026-04-23
status: shipping
---

# rd-console v6 changelog

Bridge doc — copy to Obsidian (`Vault/rd-console/v6.md` suggested) as-is or
chunk by section.

## Summary

v6 closed the "beta feel" with a dense round of bug triage + UX refinements
after live testing. Also restructured the deployment: production LXC now
runs a **headless backend** and the UI lives on a separate host (mac-mini)
against the remote API via CORS.

## PRs shipped

| # | Title | Tests delta |
|---|-------|-------------|
| #27 | Settings tabbed shell + Security + Advanced + rename Account | +2 back / +3 front |
| #28 | Invite share panel (email / WhatsApp / Telegram / QR) | +1 front |
| #29 | Logs soft-delete with 30-day retention + self-audit protection | +10 back / +1 front |
| #30 | Appearance tab (later fixed in #34) | +7 front |
| #31 | Protect initial admin (id=1) + row-click edit on UsersPage | +5 back / +2 front |
| #32 | Devices / Address Book explainer + hbbs-watcher regex diagnostics | n/a |
| #33 | Join tokens: hide revoked by default + hard-delete + bulk + cancel toast | +6 back / +4 front |
| #34 | Appearance real: accent + font-scale actually work; drop density/radius | +7 front (net) |
| #35 | Tags redesign: auto-tags + remove TagsPage + AB row-click + rename to "API tokens" | +8 back / +1 front |
| — | Headless backend flag + split deploy (`Dockerfile.frontend`) | +2 back |

Totals: **192 backend tests, 100 frontend tests**, ruff + tsc clean.

## Architecture delta

### Split deployment

- LXC 105 runs the backend with `RD_DISABLE_FRONTEND=true` — answers
  `/api/*` and `/admin/api/*` only, every other GET returns 404.
- mac-mini runs an nginx image built from `Dockerfile.frontend` with
  `VITE_API_BASE=https://rustdesk.casaredes.cc` baked into the bundle.
- `RD_CORS_ORIGINS` on the backend includes the mac-mini origin.

Motivation: a reverse-proxy misroute won't accidentally serve the
rd-console login shell to an unrelated hostname. Staging UI can live on
any host without redeploying production.

Deploy gotcha: `docker restart` on the mac-mini won't pick up a new image.
Use `docker rm -f rdc-macmini-ui && docker run -d --name rdc-macmini-ui …`.

### Backend

- `RuntimeSetting` table (k/v) for the three operator-editable values
  (server_host, panel_url, hbbs_public_key). Settings UI edits these and
  `routers/join.py` reads through the same helper → changes live
  without a restart.
- New `services/auto_tags.py` that reconciles auto-tags against a
  device's platform / version / owner. Hooked from `hbbs_sync`,
  `/api/sysinfo`, and PATCH device. Idempotent, flagged
  `Tag.auto=True` + `Tag.auto_source`, un-deletable through the admin
  tags router.
- Soft delete for audit logs with a 30-day retention floor + self-audit
  protection (LOGS_DELETED rows are themselves un-deletable).
- Initial admin (`id=1`) is now strictly untouchable via `_assert_not_initial_admin`.
  Applied to hard-delete, disable, PATCH demote/disable, and bulk ops.
- Rate limiter at `services/rate_limit.py` — 10/min/IP on `/api/auth/login`,
  30/min/IP on `/api/join/:token`.
- Join tokens gained hard-delete + bulk + `?include_revoked=false` default.

### Frontend

- Tabs shell in Settings: Server / Appearance / Language / Security /
  Advanced. Deep-link via `?tab=security`.
- Appearance: theme, accent (6 presets that REALLY repaint via FLAT
  tokens rewritten under `:root[data-accent="X"]`), font-scale (slider
  85–120%, driven by `html { font-size: calc(14px * var(--rd-font-scale)) }`
  + mass px→rem migration in components.css + layout.css), sidebar
  follow-theme fix in light mode. Density + corner radius removed.
- Join tokens UX: single-use invite URL is the primary artefact,
  sharing via mailto / wa.me / t.me / inline QR; `copiedAt` tracking
  skips the dismiss-confirm after copy; "No invitation created" toast
  on Cancel.
- Users: `onRowClick={setEditing}` opens inline Edit; Disable +
  Delete permanently menu items are disabled for `row.id === 1`.
- TagsPage eliminated (auto-tags make it redundant). Sidebar entry +
  route + tests removed. Backend endpoints survive for reads.
- Address Book: `onRowClick={openEdit}` for uniformity with Users +
  Devices.
- "My account" → "API tokens" in sidebar + page title. Subtitle
  explicitly disclaims the overlap with login password and with join
  invites.
- hbbs-watcher sidecar now logs SEEN/MATCHED counters every 10min +
  unmatched `update_pk` samples, so regex drift is diagnosable from
  `journalctl -u hbbs-watcher` without shelling into hbbs.

## Known caveats

- Devices still sometimes show Offline for a minute or two after a
  client connects — hbbs only emits `update_pk` periodically. Nothing
  we can do without patching the free client.
- Density / corner radius appearance controls removed in #34. The
  legacy localStorage blobs ignore them silently (no migration
  required).
- The rd-console SPA was briefly served from `dockge-media.casaredes.cc`
  because the reverse-proxy router was mis-configured to a non-matching
  host. v6 headless backend makes this a 404 instead of a misleading
  login page, but the NPM mis-routing itself is not fixed in-repo.

## Next (v7 candidates)

- i18n (ES / EN / FR / DE / PT) — trasladado del v5 original
- `rustdesk://connect?id=X` deep-link buttons in Device + AddressBook
- Prometheus `/metrics`
- Device edit drawer: first-class Tags section with auto-chips + manual
  TagInput
- Forgot-password + email flow

## Operational cheatsheet

```bash
# Backend smoke
curl https://rustdesk.casaredes.cc/health

# Redeploy backend (LXC 105)
ssh pve2 'sudo -n /usr/sbin/pct exec 105 -- /usr/local/bin/claude-wrapper \
  bash /opt/rustdesk/rdc-deploy.sh'
ssh pve2 'sudo -n /usr/sbin/pct exec 105 -- /usr/local/bin/claude-wrapper \
  bash /opt/rustdesk/rdc-recreate-api.sh'

# Redeploy frontend (mac-mini) — MUST rm+run, not restart
ssh mac-mini 'sudo -n docker rm -f rdc-macmini-ui
  && sudo -n docker run -d --name rdc-macmini-ui \
     -p 8090:8080 --restart unless-stopped rd-console-ui:macmini'

# Tail heartbeat signal
ssh pve2 'sudo -n /usr/sbin/pct exec 105 -- /usr/local/bin/claude-wrapper \
  journalctl -u hbbs-watcher -n 20'
```
