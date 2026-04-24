# Sprint A1 — Bloque 5 — E2E Playwright setup

> Reconnaissance + skeleton code for the Playwright smoke suite.
> Produced by a spike on 2026-04-24. Next sprint drops the files below and
> implements the 5 specs.

## 1. Dev server reality

Frontend (`frontend/vite.config.ts`):
- Port `5173` (hardcoded line 14)
- Proxy `/api` and `/admin/api` → `http://localhost:8080` (lines 15-18)
- `VITE_API_BASE` env var overrides proxy if set
- Start: `cd frontend && npm install && npm run dev`

Backend (`backend/README.md:49-65`):
- `cd backend && uv venv && uv pip install -e ".[dev]"`
- `uv run uvicorn app.main:app --reload --port 8080`
- Default SQLite path: `/data/rd_console.sqlite3` (env var `RD_DB_PATH`)
- Admin bootstrap: only if `RD_ADMIN_PASSWORD` is non-empty (`config.py:83`,
  `main.py:42-71`)

## 2. `backend/run-e2e-server.sh`

```bash
#!/bin/bash
# Fresh, isolated FastAPI backend for Playwright E2E tests.
# Deletes stale DB, bootstraps admin, binds to 127.0.0.1:8080.
set -e

DB_PATH="/tmp/rdc-e2e.db"
rm -f "$DB_PATH"

export RD_DB_PATH="$DB_PATH"
export RD_ADMIN_USERNAME="admin"
export RD_ADMIN_PASSWORD="e2e-password-1234"
export RD_DISABLE_FRONTEND="true"
export RD_SECRET_KEY="dev-key-change-me-32-chars-minimum-okay"
export RD_ENVIRONMENT="dev"

cd "$(dirname "$0")"
exec uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload 2>&1
```

Delete DB on every run → zero state carryover. Loopback binding only.

## 3. `frontend/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: [
    {
      command: 'bash ../backend/run-e2e-server.sh',
      port: 8080,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: false,
    },
  ],
  use: {
    baseURL: 'http://localhost:5173',
    storageState: 'e2e/.auth/admin.json',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

Array `webServer` starts backend then frontend. `storageState` skips login
in every spec (pre-populated by the setup below).

## 4. `frontend/e2e/fixtures/auth.ts` (setup spec)

```typescript
import { test as setup } from '@playwright/test';

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'e2e-password-1234';
const AUTH_FILE = 'e2e/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 5000 });
  await page.fill('input[autocomplete="username"]', ADMIN_USER);
  await page.fill('input[autocomplete="current-password"]', ADMIN_PASS);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://localhost:5173/dashboard', { timeout: 10000 });
  await page.context().storageState({ path: AUTH_FILE });
});
```

## 5. Spec files

| File | Happy-path assertion |
|---|---|
| `e2e/login.spec.ts` | Admin logs in → dashboard → username in top bar |
| `e2e/devices.spec.ts` | Nav to Devices → table renders, rows visible if data |
| `e2e/invite.spec.ts` | Create join token → copy works → appears in list |
| `e2e/backup.spec.ts` | Settings → Advanced → "Download backup" button clickable (Bloque 4 must land first) |
| `e2e/tokens.spec.ts` | Create PAT → plaintext shown once → revoke works |

## 6. `frontend/package.json` additions

```json
"scripts": {
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:install": "playwright install"
},
"devDependencies": {
  "@playwright/test": "^1.52.0"
}
```

## 7. Gotchas

1. **JWT persistence across contexts** — Zustand persists to `rd:auth` in
   localStorage; Playwright's `storageState` snapshots it. Don't edit
   localStorage directly in specs; always hit the API.
2. **SPA client-side routing** — `page.waitForURL()` is safer than DOM
   checks (React still hydrating). Always `page.waitForSelector()` before
   interacting.
3. **i18n bootstrap delay** — translations load async, 100-500ms cold.
   Guard every `fill/click` with `waitForSelector`.
4. **webServer startup race** — Playwright auto-waits for the port to
   accept connections, but the backend may be 1-2s behind that (DB init,
   admin bootstrap). Add an explicit `page.goto('/health')` at the start
   of the setup spec if flakes show up.
5. **Fresh SQLite each run** — no device state carries over; if a spec
   needs devices, seed via `/api/heartbeat` or a fixture inside the spec.

## 8. Implementation checklist for when Bloque 5 starts

- [ ] Drop `backend/run-e2e-server.sh` + `chmod +x`
- [ ] Create `frontend/playwright.config.ts`
- [ ] Create `frontend/e2e/fixtures/auth.ts`
- [ ] Implement the 5 specs above (one commit per spec keeps PR reviewable)
- [ ] Add Playwright deps + scripts to `package.json`
- [ ] `.gitignore`: `e2e/.auth/`, `test-results/`, `playwright-report/`
