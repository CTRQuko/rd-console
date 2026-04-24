/** Smoke: an already-authenticated session lands on a panel route, not
 *  on /login. Covers the happy path of the auth.setup.ts → storageState
 *  pipeline being intact. */

import { expect, test } from '@playwright/test';

test('authenticated session does not bounce to /login', async ({ page }) => {
  await page.goto('/');
  // Either the SPA forwards us to the configured landing page or — if
  // already on it — leaves us on a non-login URL. Either way `/login`
  // would mean the storage state didn't carry the JWT.
  await expect(page).not.toHaveURL(/\/login/);
});

test('top-level shell is reachable', async ({ page }) => {
  await page.goto('/dashboard');
  // The sidebar is the structural anchor of every authenticated page.
  // We don't assert text (i18n) — just the shell layout.
  await expect(page.locator('aside')).toBeVisible();
});
