import { test, expect, type Page } from '@playwright/test';
import { DEPOSIT_FEES_COPY } from '../../src/locales/depositFees';

const origin = 'http://localhost:5173';
const fixture = origin + '/e2e/fixtures/deposit-fees.html';
type Evidence = { claims: Array<{ txid: string; vout: number; maxFee: { onchain: { type: string; amount: number } } }>; settings: { depositMaxFee: { type: string; amount: number } } };
const evidence = (page: Page) => page.evaluate(() => (window as unknown as { __depositFeeEvidence: () => Evidence }).__depositFeeEvidence());

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    // Fixtures serve code and fonts locally. External wallet/provider traffic
    // is forbidden, so this test cannot authorize an actual transaction.
    return url.origin === origin && !url.pathname.startsWith('/api/')
      ? route.continue() : route.abort('blockedbyclient');
  });
});

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflow = await page.locator('.react-modal-sheet-content-scroller').evaluateAll(elements => elements.some(el => el.scrollWidth > el.clientWidth + 1));
  expect(overflow).toBe(false);
}

for (const width of [360, 390, 768]) {
  test(`@public-smoke deposit receive disclosure stays readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 844 });
    await page.goto(fixture + '?mode=receive');
    await page.getByTestId('bitcoin-tab').click();
    await expect(page.getByText('Automatic fee limit', { exact: true })).toBeVisible();
    await page.getByText('Automatic fee limit', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('Automatic fee limit', { exact: true })).toBeInViewport();
    await expect(page.getByText('Automatic fee limit', { exact: true }).locator('..')).toContainText('500 sats');
    await expect(page.getByText(/A provider deposit fee is deducted/)).toBeVisible();
    await noHorizontalOverflow(page);
    expect((await evidence(page)).claims).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`receive-fees-${width}.png`), animations: 'disabled' });
  });

  test(`@public-smoke standard deposit quote and future faster consent at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 360 ? 640 : 844 });
    await page.goto(fixture + '?future');
    const standard = page.getByRole('radio', { name: /^Standard delivery/ });
    const faster = page.getByRole('radio', { name: /^Expedited delivery/ });
    const confirm = page.getByRole('button', { name: 'Confirm delivery', exact: true });
    await expect(standard).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Deposit fee', { exact: true }).locator('..')).toContainText('198');
    await expect(page.getByText('GetYourSats fee', { exact: true }).locator('..')).toContainText('0');
    await expect(page.getByText('You receive', { exact: true }).locator('..')).toContainText('99 802');
    await expect(confirm).toBeDisabled();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`deposit-standard-${width}.png`), animations: 'disabled' });

    await faster.click();
    await expect(faster).toHaveAttribute('aria-checked', 'true');
    await expect(confirm).toBeEnabled();
    expect((await evidence(page)).claims).toEqual([]);
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`deposit-faster-review-${width}.png`), animations: 'disabled' });
    await confirm.click();
    await expect.poll(async () => (await evidence(page)).claims).toEqual([{ txid: 'a'.repeat(64), vout: 0, maxFee: { onchain: { type: 'fixed', amount: 3200 } } }]);
    await expect(confirm).toBeDisabled();
    expect((await evidence(page)).settings.depositMaxFee).toEqual({ type: 'fixed', amount: 500 });
  });
}

test('@public-smoke closing an unconfirmed faster selection authorizes nothing', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(fixture + '?future');
  await page.getByRole('radio', { name: /^Expedited delivery/ }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('deposit-fixture-closed')).toBeVisible();
  expect((await evidence(page)).claims).toEqual([]);
});

test('@public-smoke existing automatic faster policy is disclosed and standard lowers its ceiling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture + '?automatic&future&theme=dark');
  await expect(page.getByRole('radio', { name: /^Expedited delivery/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Your saved fee limit allows faster delivery automatically.')).toBeVisible();
  await expect(page.getByText('Deposit fee', { exact: true }).locator('..')).toContainText('347');
  expect((await evidence(page)).claims).toEqual([]);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('deposit-automatic-dark.png'), animations: 'disabled' });
  await page.getByRole('radio', { name: /^Standard delivery/ }).click();
  await expect.poll(async () => (await evidence(page)).claims).toEqual([{ txid: 'a'.repeat(64), vout: 0, maxFee: { onchain: { type: 'fixed', amount: 198 } } }]);
  await expect(page.getByRole('radio', { name: /^Standard delivery/ })).toHaveAttribute('aria-checked', 'true');
});

for (const language of ['ja', 'ta'] as const) {
  test(`@public-smoke localized fee rows reflow at 200 percent text size in ${language}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(fixture + '?future&lang=' + language);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const copy = DEPOSIT_FEES_COPY[language];
    const fee = page.getByText(copy.gysFee, { exact: true });
    await fee.scrollIntoViewIfNeeded();
    await expect(fee).toBeInViewport();
    const collides = await fee.evaluate(label => {
      const amount = label.nextElementSibling;
      if (!amount) return true;
      const left = label.getBoundingClientRect();
      const right = amount.getBoundingClientRect();
      return left.right > right.left && left.bottom > right.top && right.bottom > left.top;
    });
    expect(collides).toBe(false);
    await noHorizontalOverflow(page);
    const confirm = page.getByRole('button', { name: copy.confirmDelivery, exact: true });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`deposit-${language}-200-percent.png`), animations: 'disabled' });
  });
}
