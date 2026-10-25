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
  });
}

test('collapsed market panel does not mount its updating content', async ({ page }) => {
  await page.goto('/e2e/fixtures/premium-ui.html');
  const content = page.getByRole('region', { name: 'Bitcoin market price' });
  await expect(content).toHaveCount(0);
  await page.getByText('Bitcoin market', { exact: true }).click();
  await expect(content).toBeVisible();
  await page.getByText('Bitcoin market', { exact: true }).click();
  await expect(content).toHaveCount(0);
});
