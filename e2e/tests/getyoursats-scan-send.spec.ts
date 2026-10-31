import {test, expect, type Page} from '@playwright/test';
import sharp from 'sharp';

const origin = 'http://localhost:5173';
const fixture = origin + '/e2e/fixtures/scan-send.html';
const networkEvidence = new WeakMap<Page, {blocked: string[]; errors: string[]}>();
type Controls = {resolveInput: () => void; rejectInput: () => void; evidence: () => {parseCalls: number; mutations: number; pending: boolean}};
type Frame = {surfacePresent: boolean; sameSurface: boolean; stage: string | null; inputUncovered: boolean};

async function evidence(page: Page) {
  return page.evaluate(() => {
    const controls = (window as Window & {__gysScanFixture?: Controls}).__gysScanFixture;
    if (!controls) throw new Error('Scan fixture is unavailable');
    return controls.evidence();
  });
}
async function resolve(page: Page, success = true) {
  await page.evaluate(ok => {
    const controls = (window as Window & {__gysScanFixture?: Controls}).__gysScanFixture;
    if (!controls) throw new Error('Scan fixture is unavailable');
    if (ok) controls.resolveInput(); else controls.rejectInput();
  }, success);
}
async function uploadQr(page: Page) {
  const svg = await page.locator('[data-fixture-qr] svg').evaluate(element => element.outerHTML);
  const buffer = await sharp(Buffer.from(svg)).resize(256, 256).extend({top: 24, right: 24, bottom: 24, left: 24, background: '#fff'}).png().toBuffer();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({name: 'synthetic-qr.png', mimeType: 'image/png', buffer});
}
async function watchHandoff(page: Page) {
  await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="send-flow"]');
    if (!surface) throw new Error('Send underlay is missing');
    const frames: Frame[] = [];
    let animationFrame = 0;
    const record = () => {
      const current = document.querySelector('[data-testid="send-flow"]');
      const input = current?.querySelector('[data-testid="payment-input"]');
      frames.push({surfacePresent: current !== null, sameSurface: current === surface,
        stage: current?.querySelector('[data-send-stage]')?.getAttribute('data-send-stage') ?? null,
        inputUncovered: Boolean(input && !input.closest('[inert], [aria-hidden="true"]'))});
    };
    const observeFrame = () => {record(); animationFrame = requestAnimationFrame(observeFrame);};
    const observer = new MutationObserver(record);
    observer.observe(document.body, {childList: true, subtree: true, attributes: true,
      attributeFilter: ['inert', 'aria-hidden', 'data-send-stage']});
    observeFrame();
    (window as Window & {__stopScanFrames?: () => Frame[]}).__stopScanFrames = () => {
      cancelAnimationFrame(animationFrame); observer.disconnect(); record(); return frames;
    };
  });
}
async function handoffFrames(page: Page) {
  return page.evaluate(() => {
    const stopFrames = (window as Window & {__stopScanFrames?: () => Frame[]}).__stopScanFrames;
    if (!stopFrames) throw new Error('Scan handoff recording was not started');
    return stopFrames();
  });
}

test.beforeEach(async ({page, context}) => {
  const entry = {blocked: [] as string[], errors: [] as string[]};
  networkEvidence.set(page, entry);
  page.on('pageerror', error => entry.errors.push(error.name));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/api/market-overview') return route.fulfill({json:{supply:null,sentiment:null}});
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) return route.continue();
    entry.blocked.push(request.method() + ' ' + url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
});
test.afterEach(async ({page}) => {
  expect(networkEvidence.get(page)?.blocked).toEqual([]);
  expect(networkEvidence.get(page)?.errors).toEqual([]);
  expect((await evidence(page)).mutations).toBe(0);
});

for (const source of ['wallet', 'send'] as const) {
  test(`@public-smoke ${source} QR scan reaches amount entry through one continuous Send surface`, async ({page}, testInfo) => {
    await page.setViewportSize(source === 'wallet' ? {width: 390, height: 844} : {width: 1366, height: 900});
    await page.goto(fixture);
    if (source === 'send') {
      await page.getByTestId('send-button').click();
      await page.getByTestId('payment-input').fill('previous@example.invalid');
      await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
    } else {
      await page.getByRole('button', {name: 'Open menu', exact: true}).click();
      await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
    }
    await expect(page.getByRole('button', {name: 'Pick image from gallery'})).toBeVisible();
    await expect(page.getByTestId('send-flow')).toHaveAttribute('inert');
    await watchHandoff(page);
    await uploadQr(page);
    await expect.poll(() => evidence(page)).toMatchObject({parseCalls: 1, pending: true});
    await expect(page.getByRole('button', {name: 'Pick image from gallery'})).toHaveCount(0);
    await expect(page.getByTestId('send-resolving-input')).toBeVisible();
    await expect(page.getByTestId('payment-input')).toHaveCount(0);
    await page.screenshot({path: testInfo.outputPath('scan-resolving-' + source + '.png'), animations: 'disabled'});
    await resolve(page);
    await expect(page.getByLabel('Amount', {exact: true})).toBeVisible();
    await expect(page.getByTestId('payment-input')).toHaveCount(0);
    const frames = await handoffFrames(page);
    expect(frames.length).toBeGreaterThan(3);
    expect(frames.every(frame => frame.surfacePresent && frame.sameSurface && !frame.inputUncovered)).toBe(true);
    expect(frames.some(frame => frame.stage === 'resolving')).toBe(true);
    expect((await evidence(page)).parseCalls).toBe(1);
    await page.getByLabel('Amount', {exact: true}).fill('10');
    const continueButton = page.getByRole('button', {name: 'Continue', exact: true});
    await continueButton.scrollIntoViewIfNeeded();
    await expect(continueButton).toBeEnabled();
    await expect.poll(() => continueButton.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
        rect.height >= 44 && Boolean(hit && element.contains(hit));
    })).toBe(true);
    await page.screenshot({path: testInfo.outputPath('scan-amount-' + source + '.png'), animations: 'disabled'});
  });
}

test('@public-smoke cancelling a scan from Send keeps the existing destination', async ({page}) => {
  await page.goto(fixture);
  await page.getByTestId('send-button').click();
  await page.getByTestId('payment-input').fill('previous@example.invalid');
  await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(page.getByTestId('payment-input')).toHaveValue('previous@example.invalid');
  await expect(page.getByTestId('send-flow')).not.toHaveAttribute('inert');
  expect((await evidence(page)).parseCalls).toBe(0);
});

test('@public-smoke cancelling a scan from Home returns to the wallet', async ({page}) => {
  await page.setViewportSize({width: 1366, height: 900});
  await page.goto(fixture);
  await page.getByTestId('scan-button').click();
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(page.getByTestId('send-flow')).toHaveCount(0);
  await expect(page.getByTestId('send-button')).toBeVisible();
  expect((await evidence(page)).parseCalls).toBe(0);
});

test('@public-smoke an invalid scanned destination stays editable with an error', async ({page}) => {
  await page.goto(fixture);
  await page.getByTestId('send-button').click();
  await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
  await uploadQr(page);
  await expect.poll(() => evidence(page)).toMatchObject({parseCalls: 1, pending: true});
  await expect(page.getByTestId('payment-input')).toHaveCount(0);
  await resolve(page, false);
  await expect(page.getByTestId('send-error-banner')).toBeVisible();
  await expect(page.getByTestId('payment-input')).toHaveValue('alice@example.invalid');
  expect((await evidence(page)).parseCalls).toBe(1);
});

test('@public-smoke a fixed-amount QR still requires explicit destination review', async ({page}) => {
  await page.goto(fixture + '?kind=fixed');
  await page.getByTestId('send-button').click();
  await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
  await uploadQr(page);
  await expect.poll(() => evidence(page)).toMatchObject({parseCalls: 1, pending: true});
  await resolve(page);
  await expect(page.getByTestId('payment-input')).toHaveValue('lnbc1synthetic');
  await expect(page.getByTestId('continue-button')).toBeVisible();
  expect((await evidence(page)).mutations).toBe(0);
});

test('@public-smoke reduced motion preserves the scan handoff on a short screen', async ({page}) => {
  await page.setViewportSize({width: 844, height: 390});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(fixture);
  await page.getByTestId('send-button').click();
  await page.getByRole('button', {name: 'Scan QR', exact: true}).click();
  await uploadQr(page);
  await expect.poll(() => evidence(page)).toMatchObject({parseCalls: 1, pending: true});
  await resolve(page);
  await expect(page.getByLabel('Amount', {exact: true})).toBeVisible();
  await expect(page.locator('[data-send-stage="workflow"]')).toHaveCSS('transform', 'none');
});
