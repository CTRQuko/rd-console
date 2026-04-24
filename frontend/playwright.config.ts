import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite. Boots both the backend (`run-e2e-server.sh` against an
 * isolated `/tmp/rdc-e2e.db`) and the Vite dev server, then runs Chromium
 * tests against the SPA on http://localhost:5173.
 *
 * Layout:
 *   - `e2e/auth.setup.ts`  → mints `e2e/.auth/admin.json` (storage state)
 *   - `e2e/*.spec.ts`      → reuse that storage state, skip login per-test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // serial — we share one backend DB between specs
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Force a deterministic UI locale so text-based selectors are stable.
    locale: 'en-US',
  },

  webServer: [
    {
      command: 'bash ../backend/run-e2e-server.sh',
      url: 'http://127.0.0.1:8080/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],
});
