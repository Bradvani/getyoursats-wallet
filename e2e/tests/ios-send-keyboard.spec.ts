import {expect, test, type Locator, type Page} from '@playwright/test';

// Desktop WebKit cannot display an iPhone's system keyboard. These tests use
// production components + the production viewport manager and inject only the
// browser geometry events. Physical iOS Safari/PWA acceptance stays separate.
const origin = 'http://localhost:5173';
type Geometry = {height: number; offsetTop: number; scale?: number};
type ViewportWindow = Window & {
  __setKeyboardViewport?: (next: Geometry) => void;
  __gysScanFixture?: {resolveInput: () => void; evidence: () => {mutations: number}};
};
test.use({hasTouch: true});

test.beforeEach(async ({page, context}) => {
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/api/market-overview') return route.fulfill({json:{supply:null,sentiment:null}});
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    class KeyboardViewport extends EventTarget {
      height = innerHeight;
      width = innerWidth;
      offsetTop = 0;
      offsetLeft = 0;
      pageTop = 0;
      pageLeft = 0;
      scale = 1;
      onresize = null;
      onscroll = null;
    }
    const viewport = new KeyboardViewport();
    Object.defineProperty(window, 'visualViewport', {value: viewport, configurable: true});
    (window as ViewportWindow).__setKeyboardViewport = next => {
      Object.assign(viewport, {scale: 1, ...next, pageTop: next.offsetTop});
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    };
  });
});

test.afterEach(async ({page}) => {
  expect(await page.evaluate(() => (window as ViewportWindow).__gysScanFixture?.evidence().mutations)).toBe(0);
});

async function keyboard(page: Page, geometry: Geometry) {
  await page.evaluate(next => (window as ViewportWindow).__setKeyboardViewport!(next), geometry);
}
async function focusWithoutScrolling(field: Locator) {
  // Hidden opening-animation content cannot accept focus. Wait only for
  // visibility, without clicking or asking the browser to scroll the field.
  await expect(field).toBeVisible();
  await field.evaluate(element => (element as HTMLElement).focus({preventScroll: true}));
  await expect(field).toBeFocused();
}
async function expectFieldInVisibleArea(field: Locator, top: number, height: number) {
  await expect(field).toBeFocused();
  // No Playwright click/fill/scrollIntoView before measuring: those would hide
  // a broken application reveal by scrolling the target on behalf of the app.
  await expect.poll(() => field.evaluate((element, area) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.closest('.react-modal-sheet-content-scroller')!;
    const clip = scroller.getBoundingClientRect();
    return rect.top >= Math.max(clip.top, area.top) &&
      rect.bottom <= Math.min(clip.bottom, area.top + area.height) &&
      rect.left >= 0 && rect.right <= innerWidth;
  }, {top, height})).toBe(true);
}

for (const [width, height] of [[320, 667], [375, 667], [390, 844], [430, 932]]) {
  test(`portrait ${width}: recipient, amount and comment remain reachable through keyboard cycles`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height});
    await page.goto(origin + '/e2e/fixtures/scan-send.html?comments=1');
    await page.getByTestId('send-button').click();
    const recipient = page.getByTestId('payment-input');
    await expect.poll(() => recipient.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await focusWithoutScrolling(recipient);
    await keyboard(page, {height: height - 330, offsetTop: 42});
    await expectFieldInVisibleArea(recipient, 42, height - 330);
    await recipient.fill('alice@example.invalid');
    await page.screenshot({path: testInfo.outputPath(`recipient-${width}.png`)});
    await recipient.press('Enter');
    await keyboard(page, {height, offsetTop: 42}); // iOS stale dismissal offset
    await page.evaluate(() => (window as ViewportWindow).__gysScanFixture!.resolveInput());
    const amount = page.getByLabel('Amount', {exact: true});
    await expect(amount).toBeVisible();
    await focusWithoutScrolling(amount);
    await keyboard(page, {height: height - 350, offsetTop: 28});
    await expectFieldInVisibleArea(amount, 28, height - 350);
    await amount.fill('100');
    const comment = page.locator('#lnurl-comment');
    await focusWithoutScrolling(comment);
    await expectFieldInVisibleArea(comment, 28, height - 350);
    await comment.fill('Thank you');
    // Switch upwards without another keyboard resize event.
    await focusWithoutScrolling(amount);
    await expectFieldInVisibleArea(amount, 28, height - 350);
    await focusWithoutScrolling(comment);
    await expectFieldInVisibleArea(comment, 28, height - 350);
    const scroller = page.locator('.web-sheet-scrollport').last();
    await expect(scroller).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    await page.screenshot({path: testInfo.outputPath(`comment-${width}.png`)});
    await comment.evaluate(element => (element as HTMLElement).blur());
    await keyboard(page, {height, offsetTop: 28});
    await expect(page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])')).toHaveCSS('top', '0px');
    await expect(page.locator('#root')).toHaveCSS('transform', 'none');
    await expect(amount).toHaveValue('100');
    await expect(comment).toHaveValue('Thank you');
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(page.getByTestId('send-flow')).toHaveCount(0);
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('payment-input')).toBeVisible();
  });
}

test('enlarged text stays editable in a short portrait keyboard viewport', async ({page}) => {
  await page.setViewportSize({width: 375, height: 667});
  await page.goto(origin + '/e2e/fixtures/scan-send.html');
  await page.evaluate(() => {document.documentElement.style.fontSize = '32px';});
  await page.getByTestId('send-button').click();
  const recipient = page.getByTestId('payment-input');
  await focusWithoutScrolling(recipient);
  await keyboard(page, {height: 337, offsetTop: 25});
  // A large textarea can exceed the available height. Its top and caret entry
  // must remain accessible and the sheet must still have a scrollable range.
  await expect.poll(() => recipient.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 25 && rect.top < 200 && rect.left >= 0 && rect.right <= innerWidth;
  })).toBe(true);
  await recipient.fill('alice@example.invalid');
  await expect(recipient).toHaveValue('alice@example.invalid');
  expect(await page.locator('.web-sheet-scrollport').last().evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('pinch zoom is preserved and is not treated as an open keyboard', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(origin + '/e2e/fixtures/scan-send.html');
  await page.getByTestId('send-button').click();
  await keyboard(page, {height: 422, offsetTop: 100, scale: 2});
  await expect(page.locator('html')).not.toHaveClass(/keyboard-visible/);
  await expect(page.locator('#root')).toHaveCSS('transform', 'none');
  const sheet = page.locator('.react-modal-sheet-root:has([data-testid="send-flow"])');
  await expect(sheet).toHaveCSS('height', '844px');
  await expect(sheet).toHaveCSS('top', '0px');
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/);
});
