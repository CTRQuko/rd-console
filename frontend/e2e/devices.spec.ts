/** Smoke: the devices list endpoint returns an array, even when empty.
 *
 *  We hit the API directly rather than driving the UI, so this stays stable
 *  regardless of DataTable or i18n changes. An empty array is the expected
 *  state for a freshly bootstrapped E2E backend. */

import { expect, test } from '@playwright/test';

async function getJwt(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/dashboard');
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('rd:auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state: { token: string } };
    return parsed.state.token;
  });
  if (!token) throw new Error('rd:auth token not found in localStorage');
  return token;
}

test('GET /admin/api/devices returns an array', async ({ page }) => {
  const jwt = await getJwt(page);
  const res = await page.request.get('http://127.0.0.1:8080/admin/api/devices', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(Array.isArray(data)).toBe(true);
});

test('devices page renders without crashing', async ({ page }) => {
  await page.goto('/devices');
  // The shell should be present — no JS error that collapses the page.
  await expect(page.locator('aside')).toBeVisible();
});
