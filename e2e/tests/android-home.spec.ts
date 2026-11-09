import {test, expect, type Locator, type Page} from '@playwright/test';

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
async function surfaceContrast(locator: Locator) {
  return locator.evaluate(el => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d', {willReadFrequently:true})!;
    const ancestors: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) ancestors.push(node);
    // Canvas resolves CSS Color 4 values and composites translucent surfaces over their ancestors.
    for (const node of ancestors.reverse()) {
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0,0,1,1);
    }
    const background = Array.from(context.getImageData(0,0,1,1).data);
    if (background[3] !== 255) throw new Error('Contrast requires a resolved opaque surface');
    const color = getComputedStyle(el).color;
    context.fillStyle = color; context.fillRect(0,0,1,1);
    const foreground = Array.from(context.getImageData(0,0,1,1).data);
    const luminance = (rgba: number[]) => {
      const [r,g,b] = rgba.slice(0,3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const light = luminance(foreground), dark = luminance(background);
    return {ratio:(Math.max(light,dark) + .05) / (Math.min(light,dark) + .05), color, foreground, background};
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
  await page.getByTestId('home-pos').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('home-pos')).toBeInViewport({ratio:1});
  const posBox = await page.getByTestId('home-pos').boundingBox(); expect(posBox!.height).toBeGreaterThanOrEqual(48);
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
  await page.addInitScript(() => {
    const clipboard = {writeText: async (value: string) => {
      (window as Window & {__copiedAddress?: string}).__copiedAddress = value;
    }};
    Object.defineProperty(Object.getPrototypeOf(navigator), 'clipboard', {configurable:true, get:() => clipboard});
  });
  await page.goto(fixture + '?entry=existing');
  await expect(page.getByTestId('home-identity')).toHaveText(/Choose your username.*@getyoursats.com/);
  await expect(page.getByText('auditexample1234@breez.tips',{exact:true})).toHaveCount(0);
  await page.getByTestId('home-identity').click();
  await expect(page.getByRole('heading',{name:'Personalise Fixture'})).toBeVisible();
  await page.getByRole('button',{name:'Return to Wallet',exact:true}).click();
  await page.getByTestId('receive-button').click();
  const fallback = page.getByTestId('lightning-address-text');
  await expect(fallback).toContainText('auditexample...4@breez.tips');
  await fallback.getByTestId('copy-button').click();
  await expect.poll(() => page.evaluate(() => (window as Window & {__copiedAddress?: string}).__copiedAddress))
    .toBe('auditexample1234@breez.tips');
});

test('market arrow expands inline, closes by keyboard and preserves the chosen denomination', async ({page}) => {
  await page.setViewportSize({width:360,height:640});
  await page.goto(fixture + '?entry=existing&balance=1&complete=1');
  const market = page.getByTestId('bitcoin-market');
  const toggle = market.getByTestId('open-bitcoin-market');
  const details = market.getByTestId('market-details');
  const homeHeight = await page.getByTestId('wallet-scroll').evaluate(el => el.clientHeight);
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(page.getByTestId('market-overview')).toHaveCount(0);
  await toggle.locator('svg').click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute('id',await toggle.getAttribute('aria-controls') ?? '');
  await expect(page.getByRole('dialog',{name:'Bitcoin market'})).toHaveCount(0);
  await expect(page.getByTestId('wallet-scroll').getByTestId('market-details')).toBeVisible();
  await expect(market.locator('button button')).toHaveCount(0);
  await expect(details.getByTestId('market-supply')).toContainText('20,000,000 BTC');
  await expect(details.getByTestId('market-sentiment')).toContainText('50/100Neutral');
  await details.getByTestId('market-unit-1k').click();
  await expect(market.getByTestId('market-quote-price')).toHaveText('$0.90');
  expect(await page.getByTestId('wallet-scroll').evaluate(el => el.clientHeight)).toBe(homeHeight);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(details).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(details.getByTestId('market-unit-1k')).toHaveAttribute('aria-pressed','true');
  await toggle.locator('svg').click();
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(details).toBeHidden();
  await expect(market.getByTestId('market-quote-price')).toHaveText('$0.90');
  await page.getByRole('button',{name:'View full transaction history'}).click();
  await expect(page.getByRole('heading',{name:'History',exact:true})).toBeInViewport({ratio:1});
  await page.getByRole('button',{name:'Back to Wallet'}).click();
  await expect(page.getByTestId('home-identity')).toBeInViewport({ratio:1});
});

for (const theme of ['dark','orange']) test(`POS opens from Home and its highlighted menu entry in ${theme}`, async ({page}) => {
  await page.setViewportSize({width:360,height:640});
  await page.goto(fixture + `?entry=existing&balance=1&complete=1&theme=${theme}`);
  const terminal = page.getByRole('dialog',{name:'Merchant point of sale'});
  if (theme === 'orange') {
    const posContrast = await surfaceContrast(page.getByTestId('home-pos').locator('span'));
    expect(posContrast.ratio,JSON.stringify(posContrast)).toBeGreaterThanOrEqual(4.5);
    const icons = page.locator('.gys-wallet-toolbar button svg');
    expect(await icons.count()).toBeGreaterThan(0);
    for (const icon of await icons.all()) {
      const contrast = await surfaceContrast(icon);
      expect(contrast.ratio,JSON.stringify(contrast)).toBeGreaterThanOrEqual(3);
    }
    const chevronContrast = await surfaceContrast(page.getByTestId('open-bitcoin-market').locator('svg'));
    expect(chevronContrast.ratio,JSON.stringify(chevronContrast)).toBeGreaterThanOrEqual(3);
  }
  await page.getByTestId('home-pos').click();
  await expect(terminal).toBeVisible();
  await expect(terminal.getByRole('button',{name:'Charge',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close point of sale'}).click();
  await expect(terminal).toHaveCount(0);
  await page.getByTestId('menu-button').click();
  const menuPos = page.getByTestId('menu-pos');
  await expect(menuPos).toBeInViewport({ratio:1});
  const prominence = await menuPos.evaluate(el => {
    const style = getComputedStyle(el);
    const normal = el.closest('nav')!.querySelector('button:not([data-testid="menu-pos"])')!;
    return {border:parseFloat(style.borderTopWidth), background:style.backgroundColor,
      normalBackground:getComputedStyle(normal).backgroundColor};
  });
  expect(prominence.border).toBeGreaterThanOrEqual(1);
  expect(prominence.background).not.toBe(prominence.normalBackground);
  if (theme === 'orange') {
    const contrast = await surfaceContrast(menuPos.locator('span').last());
    expect(contrast.ratio,JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
  }
  await menuPos.click();
  await expect(terminal).toBeVisible();
  await expect(terminal.getByRole('button',{name:'Charge',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close point of sale'}).click();
  await expect(page.getByTestId('home-pos')).toBeVisible();
});
