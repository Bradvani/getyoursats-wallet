import {expect, test, type Locator, type Page} from '@playwright/test';

const origin = 'http://localhost:5173';
const fixture = origin + '/e2e/fixtures/backup-setup.html';
const evidence = new WeakMap<Page, {blocked: string[]; errors: string[]}>();

async function fullyVisible(control: Locator) {
  await expect(control).toBeInViewport({ratio: 1});
  const box = await control.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect.poll(() => control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return [[.5, .5], [.25, .08], [.75, .92]].every(([x, y]) => {
      const hit = document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y);
      return hit === element || (hit !== null && element.contains(hit));
    });
  })).toBe(true);
}

test.beforeEach(async ({page, context}) => {
  page.setDefaultTimeout(15000);
  const record = {blocked: [] as string[], errors: [] as string[]};
  evidence.set(page, record);
  page.on('pageerror', error => record.errors.push(error.name));
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.startsWith('/api/')) {
      return route.continue();
    }
    record.blocked.push(request.method() + ' ' + url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
});

test.afterEach(async ({page}) => {
  expect(evidence.get(page)?.errors).toEqual([]);
  expect(evidence.get(page)?.blocked).toEqual([]);
  const state = await page.evaluate(() => {
    const proof = (window as Window & {__gysBackupFixture?: {
      credentialRequests: number; completionRequests: number;
    }}).__gysBackupFixture;
    return {proof, storedSeed: localStorage.getItem('walletMnemonic'), activeCredential: localStorage.getItem('passkeyActiveCredentialId')};
  });
  expect(state.proof).toMatchObject({credentialRequests: 0, completionRequests: 0});
  expect(state.storedSeed).toBeNull();
  expect(state.activeCredential).toBeNull();
  await expect(page.getByTestId('recovery-word-grid')).toHaveCount(0);
});

test('@public-smoke backup leads with a guarded offline copy and keeps passkey review secondary', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(fixture);
  await expect(page.getByRole('heading', {name: 'Back up before adding funds'})).toBeVisible();
  await expect(page.getByText(/independent way back/)).toBeVisible();
  await expect(page.getByTestId('backup-reveal')).toBeDisabled();
  await fullyVisible(page.getByTestId('backup-reveal'));
  await expect(page.getByText(/optional/i)).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Keep Using My Passkey'})).toHaveCount(0);
  const details = page.getByTestId('passkey-recovery-details');
  expect(await details.evaluate(element => (element as HTMLDetailsElement).open)).toBe(false);
  await details.locator('summary').click();
  await expect(details.getByText(/cannot verify that your passkey has synced/)).toBeVisible();
  const review = details.getByRole('button', {name: 'Save Passkey Review'});
  await expect(review).toBeDisabled();
  expect(await review.evaluate(element => element.closest('footer'))).toBeNull();
  await expect(page.getByRole('button', {name: 'Done', exact: true})).toHaveCount(0);
  await expect(page.getByTestId('backup-reveal')).toBeDisabled();
});

for (const view of [
  {width: 320, height: 568, theme: 'dark', language: 'en', title: 'Back up before adding funds'},
  {width: 390, height: 844, theme: 'orange', language: 'en', title: 'Back up before adding funds'},
  {width: 320, height: 568, theme: 'dark', language: 'ar', title: 'أنشئ نسخة احتياطية قبل إضافة الأموال'},
  {width: 390, height: 844, theme: 'orange', language: 'ar', title: 'أنشئ نسخة احتياطية قبل إضافة الأموال'},
]) {
  test(`@public-smoke private backup fits ${view.language} ${view.theme} ${view.width}x${view.height}`, async ({page}, testInfo) => {
    await page.setViewportSize({width: view.width, height: view.height});
    await page.goto(fixture + '?language=' + view.language + '&theme=' + view.theme);
    await expect(page.locator('html')).toHaveAttribute('lang', view.language);
    await expect(page.locator('html')).toHaveAttribute('dir', view.language === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-gys-theme', view.theme);
    await expect(page.getByRole('heading', {name: view.title})).toBeVisible();
    const reveal = page.getByTestId('backup-reveal');
    await expect(reveal).toBeDisabled();
    await fullyVisible(reveal);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({path: testInfo.outputPath('backup-initial.png'), animations: 'disabled'});
    const checks = page.getByRole('checkbox');
    await expect(checks).toHaveCount(2);
    for (const check of await checks.all()) {
      const label = check.locator('..');
      await label.scrollIntoViewIfNeeded();
      await fullyVisible(label);
      await expect(check).not.toBeChecked();
      const bounds = await label.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(view.width + 1);
      await fullyVisible(reveal);
    }
    await page.screenshot({path: testInfo.outputPath('backup-private-checks.png'), animations: 'disabled'});
  });
}

test('@public-smoke localized backup headers leave room for the brand and back button', async ({page}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844});
  for (const language of ['en', 'hi', 'es', 'pt', 'ja', 'th', 'vi', 'ta', 'ar', 'zh-CN']) {
    await page.goto(fixture + '?language=' + language + '&theme=orange');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const title = page.getByRole('heading', {level: 1});
    await expect(title).toBeVisible();
    const brand = page.locator('header .gys-page-header__brand');
    const back = page.locator('header button');
    await expect(brand).toBeVisible();
    await expect(back).toBeVisible();
    await expect.poll(async () => {
      const heading = await title.boundingBox();
      const peers = await Promise.all([brand.boundingBox(), back.boundingBox()]);
      if (!heading || peers.some(peer => !peer)) return false;
      return peers.every(peer => peer && (
        heading.x + heading.width + 8 <= peer.x || peer.x + peer.width + 8 <= heading.x
      ));
    }, {message: language + ' header title needs a visible gap from the brand and back control'}).toBe(true);
    await expect(page.getByTestId('backup-reveal')).toBeDisabled();
    await expect(page.getByTestId('recovery-word-grid')).toHaveCount(0);
    await page.screenshot({path: testInfo.outputPath('backup-header-' + language + '.png'), animations: 'disabled'});
  }
});

test('@public-smoke backup consent is keyboard accessible with reduced motion without starting authentication', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(fixture);
  const privateCheck = page.getByRole('checkbox', {name: /I am in a private space/});
  const paperCheck = page.getByRole('checkbox', {name: /I understand these words control my wallet/});
  const reveal = page.getByTestId('backup-reveal');
  await privateCheck.focus();
  await expect(privateCheck).toBeFocused();
  await page.keyboard.press('Space');
  await expect(privateCheck).toBeChecked();
  await expect(reveal).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(paperCheck).toBeFocused();
  await page.keyboard.press('Space');
  await expect(paperCheck).toBeChecked();
  await expect(reveal).toBeEnabled();
  await reveal.focus();
  await expect(reveal).toBeFocused();
  await fullyVisible(reveal);
  await page.getByRole('button', {name: 'Go back', exact: true}).click();
  await expect(page.getByTestId('backup-fixture-closed')).toBeVisible();
});
