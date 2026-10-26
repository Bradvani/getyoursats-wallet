import {test, expect, type Locator, type Page} from '@playwright/test';

const origin = 'http://localhost:5173';
const fixture = `${origin}/e2e/fixtures/wallet-setup.html`;
const identities = {a: `02${'a'.repeat(64)}`, b: `03${'b'.repeat(64)}`} as const;
const runEvidence = new WeakMap<Page, {blocked: string[]; errors: string[]}>();

async function progress(page: Page, wallet: keyof typeof identities = 'a') {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, `gys:wallet-setup:v1:mainnet:${identities[wallet]}`);
}

async function selectWallet(page: Page, wallet: keyof typeof identities) {
  await page.evaluate(selected => {
    const fixtureWindow = window as Window & {
      __gysWalletSetupFixture?: {selectWallet: (wallet: 'a' | 'b') => void};
    };
    if (!fixtureWindow.__gysWalletSetupFixture) throw new Error('Setup fixture is not ready');
    fixtureWindow.__gysWalletSetupFixture.selectWallet(selected);
  }, wallet);
}

async function setTourAllowed(page: Page, allowed: boolean) {
  await page.evaluate(value => {
    const fixtureWindow = window as Window & {
      __gysWalletSetupFixture?: {setTourAllowed: (allowed: boolean) => void};
    };
    if (!fixtureWindow.__gysWalletSetupFixture) throw new Error('Setup fixture is not ready');
    fixtureWindow.__gysWalletSetupFixture.setTourAllowed(value);
  }, allowed);
}

async function expectFullyVisibleAction(control: Locator) {
  await expect(control).toBeInViewport({ratio: 1});
  const box = await control.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => control.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const points = [
      [rect.x + rect.width / 2, rect.y + rect.height / 2],
      [rect.x + rect.width / 4, rect.y + 2],
      [rect.x + rect.width * 3 / 4, rect.y + rect.height - 2],
    ];
    return points.every(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit === button || (hit !== null && button.contains(hit));
    });
  })).toBe(true);
}

const tour = (page: Page) => page.getByRole('dialog', {name: 'Wallet tour', exact: true});
const step = (page: Page) => tour(page).locator('[data-wallet-tour-step]');

async function finishTour(page: Page) {
  for (const current of ['protect', 'balance', 'receive', 'identity']) {
    await expect(step(page)).toHaveAttribute('data-wallet-tour-step', current);
    await tour(page).getByRole('button', {name: current === 'identity' ? 'Finish Tour' : 'Next', exact: true}).click();
  }
  await expect(tour(page)).toHaveCount(0);
}

test.beforeEach(async ({page, context}) => {
  page.setDefaultTimeout(15000);
  const evidence = {blocked: [] as string[], errors: [] as string[]};
  runEvidence.set(page, evidence);
  page.on('pageerror', error => evidence.errors.push(error.name));
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    evidence.blocked.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
});

test.afterEach(async ({page}) => {
  const evidence = runEvidence.get(page);
  expect(evidence?.errors).toEqual([]);
  expect(evidence?.blocked).toEqual([]);
});

test('@public-smoke a fresh passkey wallet starts a manual recovery-first tour', async ({page}) => {
  await page.goto(fixture);
  await expect(tour(page)).toBeVisible();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await expect(tour(page)).toContainText('Your passkey opens this wallet');
  await expect(tour(page).getByRole('progressbar', {name: 'Tour progress'})).toHaveAttribute('aria-valuenow', '1');
  await expect(tour(page).getByRole('button', {name: 'Review Recovery', exact: true})).toBeVisible();
  expect(await progress(page)).toMatchObject({recoveryStatus: 'pending'});
  await page.clock.install();
  await page.clock.fastForward(60000);
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
  expect(await progress(page)).toMatchObject({recoveryStatus: 'pending'});
});

test('@public-smoke verified phrase backup is acknowledged and completed setup clears the card', async ({page}) => {
  await page.goto(`${fixture}?method=phrase`);
  await expect(tour(page)).toContainText('Offline backup confirmed');
  await expect(tour(page).getByRole('button', {name: 'Review Recovery', exact: true})).toHaveCount(0);
  expect(await progress(page)).toMatchObject({recoveryStatus: 'phrase-verified'});
  await finishTour(page);
  await expect(page.getByRole('region', {name: 'Wallet setup', exact: true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('receive-button')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Wallet setup', exact: true})).toHaveCount(0);
});

test('@public-smoke Skip remembers the step and Home resumes it after reload', async ({page}) => {
  await page.goto(fixture);
  await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
  await tour(page).getByRole('button', {name: 'Skip for now', exact: true}).click();
  await expect(tour(page)).toHaveCount(0);
  const card = page.getByRole('region', {name: 'Wallet setup', exact: true});
  await expect(card.getByRole('button', {name: /Review your recovery/})).toBeVisible();
  await expect(card.getByRole('button', {name: /Continue your wallet tour/})).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({tourStatus: 'skipped', step: 'balance', recoveryStatus: 'pending'});
  await card.getByRole('button', {name: /Continue your wallet tour/}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
});

test('@public-smoke finishing the tour leaves unreviewed protection outstanding', async ({page}) => {
  await page.goto(fixture);
  await finishTour(page);
  const card = page.getByRole('region', {name: 'Wallet setup', exact: true});
  await expect(card).toContainText('1 of 2');
  await expect(card.getByRole('button', {name: /Review your recovery/})).toBeVisible();
  expect(await progress(page)).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
  await expect(page.getByTestId('receive-button')).toBeVisible();
});

test('@public-smoke recovery action returns safely when cancelled and records only its explicit completion', async ({page}) => {
  await page.goto(fixture);
  await tour(page).getByRole('button', {name: 'Review Recovery', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Recovery Fixture', exact: true})).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await page.getByRole('button', {name: 'Cancel Fixture Recovery', exact: true}).click();
  expect(await progress(page)).toMatchObject({recoveryStatus: 'pending'});
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await tour(page).getByRole('button', {name: 'Review Recovery', exact: true}).click();
  await page.getByRole('button', {name: 'Confirm Fixture Recovery', exact: true}).click();
  await expect(tour(page)).toContainText('Passkey recovery reviewed');
  expect(await progress(page)).toMatchObject({recoveryStatus: 'passkey-reviewed'});
  await finishTour(page);
  await expect(page.getByRole('region', {name: 'Wallet setup', exact: true})).toHaveCount(0);
});

test('@public-smoke synthetic wallets retain independent setup progress when switching', async ({page}) => {
  await page.goto(fixture);
  await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await tour(page).getByRole('button', {name: 'Skip for now', exact: true}).click();
  await selectWallet(page, 'b');
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  expect(await progress(page, 'b')).toMatchObject({tourStatus: 'active', recoveryStatus: 'pending'});
  await finishTour(page);
  await selectWallet(page, 'a');
  await expect(page.getByRole('region', {name: 'Wallet setup', exact: true})).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page, 'a')).toMatchObject({tourStatus: 'skipped', step: 'balance', recoveryStatus: 'pending'});
  expect(await progress(page, 'b')).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
});

test('@public-smoke an existing wallet can discover setup and replay the tour from Settings', async ({page}) => {
  await page.setViewportSize({width: 1366, height: 900});
  await page.goto(`${fixture}?entry=existing`);
  await expect(page.getByRole('region', {name: 'Wallet setup', exact: true})).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await page.getByRole('region', {name: 'Wallet setup', exact: true})
    .getByRole('button', {name: /Explore your wallet/}).click();
  await finishTour(page);
  const nav = page.getByRole('complementary', {name: 'Wallet navigation'});
  await nav.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Wallet Tour', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await expect(page.getByRole('heading', {name: 'Settings', exact: true})).toHaveCount(0);
});

test('@public-smoke choosing a name opens the optional destination without sending anything', async ({page}) => {
  await page.goto(fixture);
  for (let index = 0; index < 3; index++) await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'identity');
  await expect(tour(page)).toContainText('Email is optional and does not recover your wallet');
  await tour(page).getByRole('button', {name: 'Choose My Name', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Personalise Fixture', exact: true})).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await page.getByRole('button', {name: 'Return to Wallet', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'identity');
});

test('@public-smoke a covering screen suppresses the tour and releasing it resumes the same step', async ({page}) => {
  await page.goto(`${fixture}?covered=1`);
  await expect(page.getByTestId('receive-button')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({tourStatus: 'active', step: 'protect'});
  await setTourAllowed(page, true);
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
  await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
  await setTourAllowed(page, false);
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({tourStatus: 'active', step: 'balance', recoveryStatus: 'pending'});
  await setTourAllowed(page, true);
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'balance');
});

test('@public-smoke a restored named wallet sees its existing address without another claim prompt', async ({page}) => {
  await page.goto(`${fixture}?entry=existing&named=1`);
  await page.getByRole('region', {name: 'Wallet setup', exact: true})
    .getByRole('button', {name: /Explore your wallet/}).click();
  for (let index = 0; index < 3; index++) await tour(page).getByRole('button', {name: 'Next', exact: true}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'identity');
  await expect(tour(page)).toContainText('Your name is ready');
  await expect(tour(page).getByRole('button', {name: 'Choose My Name', exact: true})).toHaveCount(0);
  await tour(page).getByRole('button', {name: 'Finish Tour', exact: true}).click();
  await expect(tour(page)).toHaveCount(0);
  expect(await progress(page)).toMatchObject({tourStatus: 'completed', recoveryStatus: 'pending'});
});

for (const viewport of [
  {width: 320, height: 568}, {width: 390, height: 844},
  {width: 844, height: 390}, {width: 1366, height: 900},
]) {
  test(`@public-smoke tour controls fit ${viewport.width}x${viewport.height}`, async ({page}, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(fixture);
    for (const current of ['protect', 'balance', 'receive', 'identity']) {
      await expect(step(page)).toHaveAttribute('data-wallet-tour-step', current);
      const next = tour(page).getByRole('button', {name: current === 'identity' ? 'Finish Tour' : 'Next', exact: true});
      const skip = tour(page).getByRole('button', {name: 'Skip for now', exact: true});
      for (const control of [next, skip]) {
        await expectFullyVisibleAction(control);
      }
      if (current === 'protect' || current === 'identity') {
        const contextAction = tour(page).getByRole('button', {
          name: current === 'protect' ? 'Review Recovery' : 'Choose My Name', exact: true,
        });
        await expectFullyVisibleAction(contextAction);
      }
      const panel = await step(page).boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.y).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (current === 'protect' || current === 'identity') {
        await page.screenshot({path: testInfo.outputPath(`wallet-tour-${current}.png`), animations: 'disabled'});
      }
      await next.click();
    }
    await expect(tour(page)).toHaveCount(0);
    await expect(page.getByTestId('receive-button')).toBeVisible();
  });
}

test('@public-smoke keyboard and reduced motion keep control with the user', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(fixture);
  await expect(tour(page)).toBeVisible();
  await expect(step(page)).toHaveCSS('animation-name', 'none');
  const walletRoot = page.locator('#root');
  await expect.poll(() => walletRoot.evaluate(root =>
    root.closest('[inert], [aria-hidden="true"]') !== null)).toBe(true);
  await expect(tour(page).getByRole('button', {name: 'Next', exact: true})).toBeFocused();
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    expect(await tour(page).evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  await expect.poll(() => walletRoot.evaluate(root =>
    root.closest('[inert], [aria-hidden="true"]') !== null)).toBe(false);
  expect(await progress(page)).toMatchObject({tourStatus: 'skipped', recoveryStatus: 'pending'});
  await page.getByRole('region', {name: 'Wallet setup', exact: true})
    .getByRole('button', {name: /Continue your wallet tour/}).click();
  await expect(step(page)).toHaveAttribute('data-wallet-tour-step', 'protect');
});
