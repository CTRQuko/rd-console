/** Smoke: join-token lifecycle — create a token via API, verify it appears
 *  in the list, then delete it.
 *
 *  Hits the REST surface rather than the UI to stay isolated from dialog
 *  or i18n drift. */

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

test('join-token lifecycle: create → list → delete', async ({ page }) => {
  const jwt = await getJwt(page);
  const headers = { Authorization: `Bearer ${jwt}` };

  // Create
  const createRes = await page.request.post('http://127.0.0.1:8080/admin/api/join-tokens', {
    headers,
    data: { label: 'e2e-smoke-invite', expires_in_hours: 24 },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(typeof created.id).toBe('number');
  expect(typeof created.token).toBe('string');
  const tokenId: number = created.id;

  // List — new token must appear
  const listRes = await page.request.get('http://127.0.0.1:8080/admin/api/join-tokens', {
    headers,
  });
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  expect(list.some((t: { id: number }) => t.id === tokenId)).toBe(true);

  // Delete
  const deleteRes = await page.request.delete(
    `http://127.0.0.1:8080/admin/api/join-tokens/${tokenId}`,
    { headers },
  );
  expect(deleteRes.ok()).toBeTruthy();
});
