/** Authenticate once and persist the JWT into a storage state file.
 *
 *  Every other spec in the suite reuses this file via the `chromium`
 *  project's `storageState` option, so they skip straight to the
 *  authenticated routes without re-running login each time.
 */

import { test as setup } from '@playwright/test';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'e2e-password-1234';
const AUTH_FILE = 'e2e/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');

  // Login form is hardcoded English (no i18n yet) so the autocomplete
  // attribute is the most stable selector.
  await page.fill('input[autocomplete="username"]', ADMIN_USERNAME);
  await page.fill('input[autocomplete="current-password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // Successful login redirects to the user's landing page. Default is
  // /dashboard — the landing pref in localStorage is also dashboard at
  // first launch.
  await page.waitForURL(/\/dashboard|\/devices|\/logs|\/users|\/invites/);
  await page.context().storageState({ path: AUTH_FILE });
});
