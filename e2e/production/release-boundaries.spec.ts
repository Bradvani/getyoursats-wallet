import { test, expect } from '@playwright/test';

test('production ignores the removed deposit-fixture query and retains real onboarding', async ({ page }) => {
  await page.goto('/?claimtest=1');
  await expect(page.locator('#splash')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Every sat counts.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore existing wallet' })).toBeVisible();
  await expect(page.getByText('BTC Transfer', { exact: true })).toHaveCount(0);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
});

test('onboarding text stays readable when font requests fail', async ({ page }) => {
  await page.route(/\.(?:woff2?|ttf)(?:\?.*)?$/, (route) => route.abort());
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await expect(page.locator('#splash')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore existing wallet' })).toBeVisible();
  expect(await page.evaluate(() => [...document.fonts].every((face) => face.display !== 'block'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('deployed artifact exposes its source and stamps its service-worker release', async ({ request }) => {
  const response = await request.get('/release-manifest.json');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.product).toBe('getyoursats-wallet');
  expect(manifest.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
  expect(manifest.sdk.packageSha256).toMatch(/^[0-9a-f]{64}$/);
  const worker = await (await request.get('/sw.js')).text();
  expect(worker).toContain(manifest.releaseId);
  expect(worker).not.toContain('__GETYOURSATS_RELEASE__');
  expect(worker).not.toMatch(/\.skipWaiting\(|\.clients\.claim\(/);
});
