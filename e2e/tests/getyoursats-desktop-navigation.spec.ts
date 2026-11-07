import { test, expect } from '@playwright/test';

for (const width of [1024, 1366, 1920]) {
  test(`Settings does not trap desktop navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 936 });
    await page.goto('/e2e/fixtures/premium-ui.html');
    const nav = page.getByRole('complementary', { name: 'Wallet navigation' });
    for (let repetition = 0; repetition < 3; repetition++) {
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
      await nav.getByRole('button', { name: 'History', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
      await nav.getByRole('button', { name: 'Wallet', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Wallet', exact: true })).toHaveAttribute('aria-current', 'page');
    }
    await page.screenshot({ path: `test-artifacts/navigation-${test.info().project.name}-${width}.png` });
  });
}

test('market card is visible in Wallet and unmounted in History or Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 936 });
  await page.goto('/e2e/fixtures/premium-ui.html');
  const market = page.getByRole('region', { name: 'Bitcoin market', exact: true });
  const nav = page.getByRole('complementary', { name: 'Wallet navigation' });
  await expect(market).toBeVisible();
  await nav.getByRole('button', { name: 'History', exact: true }).click();
  await expect(market).toHaveCount(0);
  await nav.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(market).toBeVisible();
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(market).toHaveCount(0);
});

for (const viewport of [{width:360,height:800}, {width:390,height:844}, {width:768,height:1024}, {width:844,height:390}]) {
  test(`touch-layout actions and Settings return at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/e2e/fixtures/premium-ui.html');
    await expect(page.getByTestId('send-button')).toBeVisible();
    await expect(page.getByTestId('receive-button')).toBeVisible();
    await page.getByTestId('menu-button').click();
    await page.getByRole('navigation', { name: 'Wallet menu' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.locator('.gys-slide-layer').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const history = await page.locator('#gys-wallet-history').boundingBox();
    expect(history!.height).toBeGreaterThan(100);
    await page.screenshot({ path: `test-artifacts/layout-${test.info().project.name}-${viewport.width}.png` });
  });
}

test('reduced-motion Settings navigation remains responsive', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1366, height: 936 });
  await page.goto('/e2e/fixtures/premium-ui.html');
  const nav = page.getByRole('complementary', { name: 'Wallet navigation' });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.gys-slide-layer').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
});
