import {expect, test, type Locator, type Page} from '@playwright/test';

const origin = 'http://localhost:5173';
type Controls = {resolveInput: () => void; evidence: () => {mutations: number; pending: boolean}};

async function tapAndType(page: Page, field: Locator, text: string) {
  await expect(field).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await expect.poll(() => field.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  await field.tap();
  await expect(field).toBeFocused();
  // Keyboard input goes to the current focus. fill() would hide lost tap focus.
  await page.keyboard.type(text);
  await expect(field).toHaveValue(text);
}

for (const platform of ['android', 'ios'] as const) {
  test.describe(`${platform} touch payment entry`, () => {
    test.use({
      hasTouch: true,
      userAgent: platform === 'ios'
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
    });

    test.beforeEach(async ({page, context}) => {
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && url.pathname === '/api/market-overview') return route.fulfill({json: {supply: null, sentiment: null}});
        if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) return route.continue();
        return route.abort('blockedbyclient');
      });
      await page.addInitScript(value => {
        Object.defineProperty(navigator, 'platform', {configurable: true, value: value === 'ios' ? 'iPhone' : 'Linux armv8l'});
      }, platform);
    });

    for (const native of [false, true]) {
    for (const [width, height] of [[360, 640], [390, 844], [640, 360]]) {
      test(`${native ? 'native adapter' : 'web'} ${width}x${height}: tap destination and amount, close and reopen`, async ({page}) => {
        await page.setViewportSize({width, height});
        await page.goto(`${origin}/e2e/fixtures/${native ? 'native-send' : 'scan-send'}.html?comments=1&platform=${platform}`);
        await page.getByTestId('send-button').tap();
        if (native) {
          const content = page.locator('.react-modal-sheet-content:has([data-testid="send-flow"])');
          await expect(content).not.toHaveCSS('touch-action', 'pan-x');
          await expect(content.locator('.react-modal-sheet-content-scroller')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
        }
        await tapAndType(page, page.getByTestId('payment-input'), 'alice@example.invalid');
        await expect(page.locator('.sheet-form-scrollport')).toHaveCSS('touch-action', 'pan-y pinch-zoom');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => (window as unknown as {__gysScanFixture: Controls}).__gysScanFixture.evidence().pending)).toBe(true);
        await page.evaluate(() => (window as unknown as {__gysScanFixture: Controls}).__gysScanFixture.resolveInput());
        const amount = page.getByLabel('Amount', {exact: true});
        await page.getByRole('button', {name: 'Max', exact: true}).tap();
        await expect(amount).toBeEditable();
        await amount.tap();
        await expect(amount).toBeFocused();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        await tapAndType(page, amount, '100');
        await tapAndType(page, page.locator('#lnurl-comment'), 'Thank you');
        await amount.tap();
        await expect(amount).toBeFocused();
        await page.keyboard.press('Backspace');
        await expect(amount).toHaveValue('10');
        await page.getByTestId('edit-send-destination').tap();
        const destination = page.getByTestId('payment-input');
        await expect(destination).toHaveValue('alice@example.invalid');
        await destination.tap();
        await expect(destination).toBeFocused();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type('bob@example.invalid');
        await expect(destination).toHaveValue('bob@example.invalid');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('send-error-banner')).toBeVisible();
        await expect(amount).toHaveCount(0);
        await page.getByRole('button', {name: 'Close', exact: true}).tap();
        await expect(page.getByTestId('send-flow')).toHaveCount(0);
        await page.getByTestId('send-button').tap();
        await tapAndType(page, page.getByTestId('payment-input'), 'bob@example.invalid');
        expect(await page.evaluate(() => (window as unknown as {__gysScanFixture: Controls}).__gysScanFixture.evidence().mutations)).toBe(0);
      });
    }
    }
  });
}
