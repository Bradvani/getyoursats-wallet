import {test, expect, type Locator, type Page} from '@playwright/test';

const origin = 'http://localhost:5173';
const fixture = origin + '/e2e/fixtures/wallet-setup.html';
const identities = {a: '02' + 'a'.repeat(64), b: '03' + 'b'.repeat(64)} as const;
const steps = ['language', 'protect', 'balance', 'receive', 'pos', 'identity'] as const;
const evidence = new WeakMap<Page, {blocked: string[]; errors: string[]}>();
const guide = (page: Page) => page.getByTestId('wallet-setup-guide');
const card = (page: Page) => page.getByTestId('wallet-setup-card');
const next = (page: Page) => page.getByTestId('wallet-setup-next');
const action = (page: Page) => page.getByTestId('wallet-setup-action');

async function progress(page: Page, wallet: keyof typeof identities = 'a') {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'),
    'gys:wallet-setup:v1:mainnet:' + identities[wallet]);
}
async function control(page: Page, operation: 'selectWallet' | 'setTourAllowed', value: 'a' | 'b' | boolean) {
  await page.evaluate(({operation, value}) => {
    const controls = (window as Window & {__gysWalletSetupFixture?: {
      selectWallet: (wallet: 'a' | 'b') => void; setTourAllowed: (allowed: boolean) => void;
    }}).__gysWalletSetupFixture;
    if (!controls) throw new Error('Setup fixture is not ready');
    if (operation === 'selectWallet' && typeof value === 'string') controls.selectWallet(value);
    if (operation === 'setTourAllowed' && typeof value === 'boolean') controls.setTourAllowed(value);
  }, {operation, value});
}
async function advanceTo(page: Page, target: typeof steps[number]) {
  for (let index = 0; index < steps.length; index++) {
    if (await guide(page).getAttribute('data-wallet-tour-step') === target) return;
    await next(page).click();
  }
  throw new Error('Guide did not reach ' + target);
}
async function finishGuide(page: Page) {
  for (let index = 0; index < steps.length; index++) {
    if (await guide(page).count() === 0) return;
    await next(page).click();
  }
  await expect(guide(page)).toHaveCount(0);
}
async function usable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ratio: 1});
  const box = await control.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => control.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return [[.5,.5], [.25,.05], [.75,.95]].every(([x,y]) => {
      const hit = document.elementFromPoint(rect.x + rect.width*x, rect.y + rect.height*y);
      return hit === button || (hit !== null && button.contains(hit));
    });
  })).toBe(true);
}

test.beforeEach(async ({page, context}) => {
  page.setDefaultTimeout(15000);
  const current = {blocked: [] as string[], errors: [] as string[]};
  evidence.set(page, current);
  page.on('pageerror', error => current.errors.push(error.name));
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if(url.origin===origin && url.pathname==='/api/market-overview' && request.method()==='GET')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({supply:null,sentiment:null})});
    if(url.origin===origin && url.pathname==='/api/notifications/device' && request.method()==='GET')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        available:false,vapidPublicKey:null,lightningInvoicePushAvailable:false,lightningAddressPushAvailable:false,
      })});
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) return route.continue();
    current.blocked.push(request.method() + ' ' + url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
});
test.afterEach(async ({page}) => {
  expect(evidence.get(page)?.errors).toEqual([]);
  expect(evidence.get(page)?.blocked).toEqual([]);
  expect(await page.evaluate(() => (window as Window & {
    __gysWalletSetupFixture?: {unexpectedSdkCalls: string[]};
  }).__gysWalletSetupFixture?.unexpectedSdkCalls ?? [])).toEqual([]);
});

test('@public-smoke fresh setup is inline, manual and leaves wallet controls available', async ({page}) => {
  await page.goto(fixture);
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'language');
  await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  await expect(guide(page).getByRole('combobox', {name: 'Language'})).toBeVisible();
  expect(await guide(page).evaluate(element => element.closest('#gys-wallet-history') !== null)).toBe(true);
  expect(await page.locator('#root').evaluate(root => root.closest('[inert], [aria-hidden="true"]') !== null)).toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(next(page)).not.toBeFocused();
  await page.getByTestId('send-button').focus();
  await expect(page.getByTestId('send-button')).toBeFocused();
  await page.clock.install();
  await page.clock.fastForward(60000);
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'language');
  await next(page).click();
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await expect(guide(page)).toContainText('Write down your recovery words');
  await expect(guide(page)).not.toContainText('backup is optional');
  expect(await progress(page)).toMatchObject({recoveryStatus: 'pending'});
});
test('@public-smoke verified phrase backup is acknowledged and completed setup clears the card', async ({page}) => {
  await page.goto(fixture + '?method=phrase');
  await advanceTo(page, 'protect');
  await expect(guide(page)).toContainText('Your recovery copy is checked');
  await expect(action(page)).toHaveCount(0);
  await finishGuide(page);
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('receive-button')).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});
test('@public-smoke Skip saves the step and Home resumes it after reload', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'balance');
  await page.getByTestId('wallet-setup-skip').click();
  await expect(guide(page)).toHaveCount(0);
  await expect(page.getByTestId('wallet-setup-backup')).toBeVisible();
  await page.reload();
  await expect(card(page)).toBeVisible();
  expect(await progress(page)).toMatchObject({tourStatus: 'skipped', step: 'balance', recoveryStatus: 'pending'});
  await page.getByTestId('wallet-setup-start').click();
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
});
test('@public-smoke finishing the guide leaves backup outstanding', async ({page}) => {
  await page.goto(fixture);
  await finishGuide(page);
  await expect(card(page)).toContainText('1/2');
  await expect(page.getByTestId('wallet-setup-backup')).toBeVisible();
  expect(await progress(page)).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
});
test('@public-smoke passkey review never completes the independent recovery backup', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'protect');
  await action(page).click();
  await expect(page.getByRole('heading', {name: 'Recovery Fixture', exact: true})).toBeVisible();
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', {name: 'Cancel Fixture Recovery', exact: true}).click();
  expect(await progress(page)).toMatchObject({recoveryStatus: 'pending'});
  await action(page).click();
  await page.getByRole('button', {name: 'Confirm Fixture Passkey Review', exact: true}).click();
  expect(await progress(page)).toMatchObject({recoveryStatus: 'passkey-reviewed'});
  await finishGuide(page);
  await expect(card(page)).toContainText('Passkey reviewed. Back up your wallet.');
  await expect(page.getByTestId('wallet-setup-backup')).toBeVisible();
});
test('@public-smoke explicit backup completion is retained while the guide resumes', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'protect');
  await action(page).click();
  await page.getByRole('button', {name: 'Confirm Fixture Backup', exact: true}).click();
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await expect(guide(page)).toContainText('Your recovery copy is checked');
  expect(await progress(page)).toMatchObject({recoveryStatus: 'phrase-verified'});
  await finishGuide(page);
  await expect(card(page)).toHaveCount(0);
});
test('@public-smoke synthetic wallets retain independent setup progress', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'balance');
  await page.getByTestId('wallet-setup-skip').click();
  await control(page, 'selectWallet', 'b');
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'language');
  await finishGuide(page);
  await control(page, 'selectWallet', 'a');
  await expect(card(page)).toBeVisible();
  await expect(guide(page)).toHaveCount(0);
  expect(await progress(page, 'a')).toMatchObject({tourStatus: 'skipped', step: 'balance', recoveryStatus: 'pending'});
  expect(await progress(page, 'b')).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
});
test('@public-smoke History remains accessible and Settings replays from Help & Information', async ({page}) => {
  await page.setViewportSize({width: 1366, height: 900});
  await page.goto(fixture + '?entry=existing');
  await page.getByTestId('wallet-setup-start').click();
  const nav = page.getByRole('complementary', {name: 'Wallet navigation'});
  await nav.getByRole('button', {name: 'History', exact: true}).click();
  await expect(page.locator('.gys-wallet')).toHaveClass(/gys-wallet--history-open/);
  await expect(guide(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({tourStatus: 'active'});
  await nav.getByRole('button', {name: 'Settings', exact: true}).click();
  const help = page.locator('details').filter({has: page.locator('summary').filter({hasText: 'Help & Information'})});
  expect(await help.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await help.locator('summary').first().click();
  const replay = help.getByRole('button', {name: 'Replay Wallet Guide', exact: true});
  await expect(replay).toBeVisible();
  await replay.click();
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'language');
  await expect(page.locator('.gys-wallet')).not.toHaveClass(/gys-wallet--history-open/);
});
test('@public-smoke name selection opens its destination and preserves the guide', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'identity');
  await expect(guide(page)).toContainText('It cannot recover your wallet');
  await action(page).click();
  await expect(page.getByRole('heading', {name: 'Personalise Fixture', exact: true})).toBeVisible();
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', {name: 'Return to Wallet', exact: true}).click();
  await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'identity');
});
test('@public-smoke a covering screen pauses the guide without changing layout or progress', async ({page}) => {
  await page.goto(fixture + '?covered=1');
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  const before = await guide(page).boundingBox();
  expect(await guide(page).evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await control(page, 'setTourAllowed', true);
  await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  expect((await guide(page).boundingBox())?.height).toBe(before?.height);
  await next(page).click();
  await control(page, 'setTourAllowed', false);
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  expect(await progress(page)).toMatchObject({tourStatus: 'active', step: 'protect', recoveryStatus: 'pending'});
  await control(page, 'setTourAllowed', true);
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
});
test('@public-smoke a restored named wallet is not asked to claim another name', async ({page}) => {
  await page.goto(fixture + '?entry=existing&named=1');
  await page.getByTestId('wallet-setup-start').click();
  await advanceTo(page, 'identity');
  await expect(guide(page)).toContainText('Your address is ready');
  await expect(action(page)).toHaveCount(0);
  await next(page).click();
  expect(await progress(page)).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
});
test('@public-smoke POS showcase opens the real keypad without creating an invoice', async ({page}) => {
  await page.goto(fixture);
  await advanceTo(page, 'pos');
  await expect(guide(page)).toContainText('Your wallet is a checkout');
  await action(page).click();
  const pos = page.getByRole('dialog', {name: 'Merchant point of sale'});
  await expect(pos).toBeVisible();
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  await pos.getByRole('button', {name: '5', exact: true}).click();
  await expect(pos.getByLabel('Charge amount')).toContainText('5');
  await expect(page.getByTestId('pos-invoice-qr')).toHaveCount(0);
  await pos.getByRole('button', {name: 'Close point of sale'}).click();
  await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', 'pos');
});
test('@public-smoke Receive stays usable while setup is unfinished', async ({page}) => {
  await page.goto(fixture);
  await page.getByTestId('receive-button').click();
  await expect(page.getByRole('heading', {name: 'Receive', exact: true})).toBeVisible();
  await expect(page.getByTestId('lightning-address-text')).toContainText('setup@example.invalid');
  await expect(guide(page)).toHaveAttribute('data-paused', 'true');
  await page.getByRole('button', {name: 'Close', exact: true}).click();
  await expect(guide(page)).toHaveAttribute('data-paused', 'false');
  expect(await progress(page)).toMatchObject({step: 'language', recoveryStatus: 'pending'});
});
test.describe('device language', () => {
  test.use({locale: 'hi-IN'});
  test('@public-smoke detected language can be overridden during setup and survives reload', async ({page}) => {
    await page.goto(fixture);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(guide(page)).toContainText('अपनी भाषा चुनें');
    await guide(page).getByRole('combobox').fill('English');
    await page.getByRole('option', {name: 'English', exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(guide(page)).toContainText('Choose your language');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(guide(page).getByRole('combobox')).toHaveValue('English');
  });
});
test('@public-smoke Arabic setup stays usable with RTL and an explicit language choice', async ({page}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gys:language:v1', 'ar'));
  await page.goto(fixture);
  await expect(guide(page)).toHaveAttribute('dir', 'rtl');
  await expect(guide(page).getByRole('combobox')).toHaveValue('العربية');
  for (const current of ['language', 'protect', 'pos'] as const) {
    await advanceTo(page, current);
    await usable(next(page));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: testInfo.outputPath('guide-ar-' + current + '.png'), animations: 'disabled'});
  }
});
for (const viewport of [
  {width: 320, height: 568}, {width: 390, height: 844}, {width: 844, height: 390}, {width: 1366, height: 900},
]) {
  test('@public-smoke inline guide controls fit ' + viewport.width + 'x' + viewport.height, async ({page}, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(fixture);
    for (const current of steps) {
      await expect(guide(page)).toHaveAttribute('data-wallet-tour-step', current);
      await usable(next(page));
      if (['protect', 'receive', 'pos', 'identity'].includes(current)) await usable(action(page));
      await usable(page.getByTestId('wallet-setup-skip'));
      const box = await guide(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (['language', 'protect', 'pos'].includes(current)) {
        await page.screenshot({path: testInfo.outputPath('wallet-guide-' + current + '.png'), animations: 'disabled'});
      }
      await next(page).click();
    }
    await expect(guide(page)).toHaveCount(0);
    await expect(page.getByTestId('receive-button')).toBeVisible();
  });
}
test('@public-smoke orange appearance preserves guide controls and feature previews', async ({page}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gys:appearance:v1', 'orange'));
  await page.goto(fixture);
  await expect(page.locator('html')).toHaveAttribute('data-gys-theme', 'orange');
  for (const current of ['protect', 'pos'] as const) {
    await advanceTo(page, current);
    await usable(action(page));
    await page.screenshot({path: testInfo.outputPath('wallet-guide-orange-' + current + '.png'), animations: 'disabled'});
  }
});
test('@public-smoke finite previews animate and reduced motion stays calm without trapping focus', async ({page}) => {
  await page.goto(fixture);
  await expect(guide(page)).toHaveAttribute('data-motion', 'full');
  expect(await guide(page).evaluate(element => element.getAnimations({subtree: true}).some(animation =>
    Number(animation.effect?.getTiming().duration) > 0))).toBe(true);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(guide(page)).toHaveAttribute('data-motion', 'reduced');
  await advanceTo(page, 'pos');
  await expect.poll(() => guide(page).evaluate(element => element.getAnimations({subtree: true})
    .filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.getByTestId('receive-button').focus();
  await expect(page.getByTestId('receive-button')).toBeFocused();
  expect(await page.locator('#root').evaluate(root => root.hasAttribute('inert'))).toBe(false);
});

test('@public-smoke welcome card exit persists across reload and stays wallet scoped', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(fixture + '?entry=existing&named=1');
  const dismiss = page.getByRole('button', {name: 'Dismiss wallet setup'});
  await usable(dismiss);
  await dismiss.click();
  await expect(card(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({cardDismissed: true, recoveryStatus: 'pending', tourStatus: 'not-started'});
  await page.reload();
  await expect(page.getByTestId('receive-button')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await control(page, 'selectWallet', 'b');
  await expect(card(page)).toBeVisible();
  await control(page, 'selectWallet', 'a');
  await expect(card(page)).toHaveCount(0);
});

test('@public-smoke named wallet with verified backup needs no completed tour to hide welcome', async ({page}) => {
  await page.goto(fixture + '?entry=existing&named=1');
  await page.getByTestId('wallet-setup-backup').click();
  await page.getByRole('button', {name: 'Confirm Fixture Backup', exact: true}).click();
  await expect(card(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({recoveryStatus: 'phrase-verified', tourStatus: 'not-started'});
  await page.reload();
  await expect(page.getByTestId('receive-button')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});
