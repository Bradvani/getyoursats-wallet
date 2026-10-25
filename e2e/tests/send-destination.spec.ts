import { test, expect } from '@playwright/test';

for (const width of [360, 390, 768, 1024, 1366, 1920]) {
  test(`stablecoin destination precedes amount and survives review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/e2e/fixtures/send-destination.html');
    await page.getByRole('button', { name: 'USDT / USDC', exact: true }).click();
    await expect(page.getByTestId('stablecoin-destination')).toBeVisible();
    await page.getByLabel('Recipient receives').selectOption('USDC');
    await page.getByLabel('Recipient address').fill('0x1111111111111111111111111111111111111111');
    await expect(page.getByLabel('Destination network')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
    await page.getByLabel('Destination network').selectOption('base');
    await page.screenshot({ path: `test-artifacts/send-destination-${width}.png` });
    await page.getByRole('button', { name: 'Continue to amount' }).click();
    await expect(page.getByTestId('send-destination-summary')).toContainText('USDC · Base');
    await page.getByTestId('amount-input').fill('10');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await expect(page.getByTestId('send-destination-summary')).toContainText('USDC · Base');
    await page.getByRole('button', { name: 'Edit destination' }).click();
    await page.getByLabel('Recipient address').fill('TDisposableTronRecipient');
    await expect(page.getByRole('button', { name: 'Continue to amount' })).toBeDisabled();
    await page.getByLabel('Recipient receives').selectOption('USDT');
    await expect(page.getByLabel('Destination network')).toBeEnabled();
    await page.getByLabel('Destination network').selectOption('tron');
    await page.getByRole('button', { name: 'Continue to amount' }).click();
    await expect(page.getByTestId('send-destination-summary')).toContainText('USDT · Tron');
    await expect(page.getByTestId('amount-input')).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-artifacts/send-network-${width}.png` });
  });
}

test('pasting a destination enters network review before amount', async ({ page }) => {
  await page.goto('/e2e/fixtures/send-destination.html');
  await page.getByTestId('payment-input').fill('SoDisposableSolanaRecipient');
  await page.getByTestId('continue-button').click();
  await expect(page.getByTestId('stablecoin-destination')).toBeVisible();
  await expect(page.getByTestId('amount-input')).toHaveCount(0);
  await page.getByLabel('Recipient receives').selectOption('USDC');
  await expect(page.getByLabel('Destination network')).toBeEnabled();
  await page.getByLabel('Destination network').selectOption('solana');
  await page.getByRole('button', { name: 'Continue to amount' }).click();
  await expect(page.getByTestId('send-destination-summary')).toContainText('USDC · Solana');
});

test('Arabic destination controls stay usable at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.addInitScript(() => localStorage.setItem('gys:language:v1', 'ar'));
  await page.goto('/e2e/fixtures/send-destination.html');
  await page.getByRole('button', { name: 'USDT / USDC', exact: true }).click();
  await expect(page.getByLabel('عنوان المستلم')).toBeVisible();
  await page.getByLabel('ما سيستلمه المستلم').selectOption('USDT');
  await page.getByLabel('عنوان المستلم').fill('TDisposableTronRecipient');
  await expect(page.getByLabel('شبكة الوجهة')).toBeEnabled();
  await page.getByLabel('شبكة الوجهة').selectOption('tron');
  await page.getByRole('button', { name: 'المتابعة إلى المبلغ' }).click();
  await expect(page.getByTestId('send-destination-summary')).toContainText('USDT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
