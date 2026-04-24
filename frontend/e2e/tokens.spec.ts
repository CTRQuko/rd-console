/** Smoke: PAT lifecycle through the API surface (create → list → revoke).
 *
 *  Uses page.request rather than UI clicks so the test stays small and
 *  doesn't drift when settings tab markup changes. UI-level coverage of
 *  the token dialog is left to the unit tests. */

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

test('PAT lifecycle: create → list → revoke', async ({ page }) => {
  const jwt = await getJwt(page);
  const headers = { Authorization: `Bearer ${jwt}` };

  // Create
  const createRes = await page.request.post('http://127.0.0.1:8080/api/auth/tokens', {
    headers,
    data: { name: 'e2e-smoke-token', expires_in_minutes: null },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  expect(created.token).toMatch(/^rdcp_/);
  expect(created.metadata.name).toBe('e2e-smoke-token');
  const tokenId: number = created.metadata.id;

  // List — must contain the new token, no plaintext field on the meta row.
  const listRes = await page.request.get('http://127.0.0.1:8080/api/auth/tokens', {
    headers,
  });
  expect(listRes.ok()).toBeTruthy();
  const list = await listRes.json();
  const found = list.find((t: { id: number }) => t.id === tokenId);
  expect(found).toBeTruthy();
  expect(found.token).toBeUndefined();
  expect(found.token_prefix).toMatch(/^rdcp_/);

  // Revoke
  const revokeRes = await page.request.delete(
    `http://127.0.0.1:8080/api/auth/tokens/${tokenId}`,
    { headers },
  );
  expect(revokeRes.ok()).toBeTruthy();
});
