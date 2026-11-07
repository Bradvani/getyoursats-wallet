import {test, expect, type Page} from '@playwright/test';

test.setTimeout(30000);

const fixture = '/e2e/fixtures/android-audit.html';
const cases = [
  {width:360,height:640,language:'en',text:100},
  {width:360,height:560,language:'en',text:100},
  {width:320,height:568,language:'en',text:100},
  {width:412,height:732,language:'en',text:100},
  {width:640,height:360,language:'en',text:100},
  {width:360,height:640,language:'hi',text:130},
  {width:360,height:560,language:'hi',text:200},
  {width:320,height:568,language:'ta',text:130},
  {width:360,height:640,language:'ar',text:200},
  {width:360,height:640,language:'en',text:200},
  {width:768,height:1024,language:'en',text:100},
  {width:1366,height:900,language:'en',text:100},
];
async function layout(page: Page) {
  return page.getByTestId('wallet-scroll').evaluate(el => {
    const dock = document.querySelector('.gys-action-dock')!.getBoundingClientRect();
    const toolbar = document.querySelector('.gys-wallet-toolbar')!.getBoundingClientRect();
    const scroll = el.getBoundingClientRect();
    return {height:scroll.height, top:scroll.top, bottom:scroll.bottom, dockTop:dock.top, dockBottom:dock.bottom,
      toolbarBottom:toolbar.bottom, overflow:document.documentElement.scrollWidth > innerWidth + 1,
      scrollOverflow:el.scrollWidth > el.clientWidth + 1};
  });
}
test.beforeEach(async ({page}) => {
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/notifications/device', route => route.fulfill({json:{available:false}}));
});
test.afterEach(async ({page}) => {
  expect(await page.evaluate(() => (window as Window & {
    __gysWalletSetupFixture?: {unexpectedSdkCalls: readonly string[]};
  }).__gysWalletSetupFixture?.unexpectedSdkCalls ?? [])).toEqual([]);
});

for (const value of cases) test(`home reflows ${value.width}x${value.height} ${value.language} ${value.text}%`, async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width:value.width,height:value.height});
  await page.goto(fixture + `?entry=existing&balance=large&complete=1&named=1&language=${value.language}&text=${value.text}&theme=${value.language === 'ar' ? 'orange' : 'dark'}`);
  await expect(page.getByTestId('home-identity')).toContainText('setupfixture@getyoursats.com');
  await expect(page.getByTestId('wallet-setup-card')).toHaveCount(0);
  const geometry = await layout(page);
  expect(geometry.overflow, JSON.stringify(geometry)).toBe(false);
  expect(geometry.scrollOverflow, JSON.stringify(geometry)).toBe(false);
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.toolbarBottom - 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.dockTop + 1);
  expect(geometry.dockBottom).toBeLessThanOrEqual(value.height + 1);
  expect(geometry.height).toBeGreaterThan(value.height * .5);
  if (value.width === 360 && value.height === 640 && value.text === 100) expect(geometry.height).toBeGreaterThanOrEqual(480);
  for (const id of ['send-button','receive-button']) {
    await expect(page.getByTestId(id)).toBeInViewport({ratio:1});
    const box = await page.getByTestId(id).boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  await page.getByTestId('open-bitcoin-market').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('open-bitcoin-market')).toBeInViewport({ratio:1});
  const firstPayment = page.locator('.gys-activity__feed button').first();
  await firstPayment.scrollIntoViewIfNeeded();
  await expect(firstPayment).toBeInViewport({ratio:1});
  await expect(page.getByTestId('send-button')).toBeInViewport({ratio:1});
  expect(errors).toEqual([]);
});

for (const text of [100,200]) test(`guide navigation resets scroll and focuses the new heading at ${text}%`, async ({page}) => {
  await page.setViewportSize({width:360,height:560});
  await page.goto(fixture + `?text=${text}`);
  const guide = page.getByTestId('wallet-setup-guide');
  await expect(guide).toHaveAttribute('data-wallet-tour-step','language');
  await expect(page.getByTestId('wallet-balance')).toHaveCount(0);
  for (const step of ['protect','balance','receive','pos','identity']) {
    await page.getByTestId('wallet-setup-next').click();
    await expect(guide).toHaveAttribute('data-wallet-tour-step',step);
    await expect.poll(() => page.getByTestId('wallet-scroll').evaluate(el => el.scrollTop)).toBe(0);
    await expect(guide.locator('[data-guide-heading]')).toBeFocused();
    await expect(page.getByTestId('wallet-setup-back')).toBeEnabled();
  }
  await page.getByTestId('wallet-setup-back').click();
  await expect(guide).toHaveAttribute('data-wallet-tour-step','pos');
  await page.getByTestId('wallet-setup-skip').click();
  await expect(guide).toHaveCount(0);
  await page.getByTestId('wallet-setup-start').click();
  await expect(guide).toHaveAttribute('data-wallet-tour-step','pos');
  await page.getByTestId('wallet-setup-next').click(); await page.getByTestId('wallet-setup-next').click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByTestId('wallet-setup-backup')).toBeVisible();
});

test('username creation is the primary identity action and the real Receive fallback stays available', async ({page}) => {
  await page.setViewportSize({width:360,height:640});
  await page.goto(fixture + '?entry=existing');
  await expect(page.getByTestId('home-identity')).toHaveText(/Choose your username.*@getyoursats.com/);
  await expect(page.getByText('auditexample1234@breez.tips',{exact:true})).toHaveCount(0);
  await page.getByTestId('home-identity').click();
  await expect(page.getByRole('heading',{name:'Personalise Fixture'})).toBeVisible();
  await page.getByRole('button',{name:'Return to Wallet',exact:true}).click();
  await page.getByTestId('receive-button').click();
  await expect(page.getByText('auditexample1234@breez.tips',{exact:true})).toBeVisible();
});

test('market details preserve denominations and return to the same Home position', async ({page}) => {
  await page.setViewportSize({width:360,height:640});
  await page.goto(fixture + '?entry=existing&balance=1&complete=1');
  await expect(page.getByTestId('market-overview')).toHaveCount(0);
  await page.getByTestId('open-bitcoin-market').scrollIntoViewIfNeeded();
  const before = await page.getByTestId('wallet-scroll').evaluate(el => el.scrollTop);
  await page.getByTestId('open-bitcoin-market').click();
  const details = page.getByRole('dialog',{name:'Bitcoin market'});
  await expect(details.getByTestId('market-supply')).toContainText('20,000,000 BTC');
  await expect(details.getByTestId('market-sentiment')).toContainText('50/100Neutral');
  await details.getByTestId('market-unit-1k').click();
  await expect(details.getByTestId('market-quote-price')).toHaveText('$0.90');
  await details.getByRole('button',{name:'Go back',exact:true}).click();
  await expect(details).toHaveCount(0);
  await expect(page.getByTestId('market-quote-price')).toHaveText('$0.90');
  expect(await page.getByTestId('wallet-scroll').evaluate(el => el.scrollTop)).toBe(before);
  await page.getByRole('button',{name:'View full transaction history'}).click();
  await expect(page.getByRole('heading',{name:'History',exact:true})).toBeInViewport({ratio:1});
  await page.getByRole('button',{name:'Back to Wallet'}).click();
  await expect(page.getByTestId('home-identity')).toBeInViewport({ratio:1});
});
