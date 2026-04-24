/** Smoke: hitting /admin/api/backup with an authenticated session returns
 *  a structurally-correct backup bundle.
 *
 *  We don't drive the full Settings → Advanced UI (that pulls in too many
 *  i18n + dialog edge cases for a smoke). Instead we use the request
 *  context attached to the storage state, which has the same Authorization
 *  header the real UI would send. */

import { expect, test } from '@playwright/test';

test('GET /admin/api/backup returns a schema_version=1 bundle', async ({ page }) => {
  // Pull the JWT out of localStorage (zustand persists under "rd:auth")
  // — that's how the SPA authenticates real requests, so we mirror it.
  await page.goto('/dashboard');
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('rd:auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state: { token: string } };
    return parsed.state.token;
  });
  expect(token, 'rd:auth token must be present in localStorage').toBeTruthy();

  const response = await page.request.get('http://127.0.0.1:8080/admin/api/backup', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBeTruthy();

  const bundle = await response.json();
  expect(bundle.schema_version).toBe(1);
  expect(Array.isArray(bundle.users)).toBe(true);
  expect(Array.isArray(bundle.tags)).toBe(true);
  expect(Array.isArray(bundle.settings)).toBe(true);

  // Redaction sanity — no secret-shaped keys in the bundle.
  const raw = JSON.stringify(bundle);
  for (const forbidden of ['password_hash', 'token_hash', 'RD_SECRET_KEY']) {
    expect(raw).not.toContain(forbidden);
  }
});
