import { test, expect } from '@playwright/test';

for (const [preference, system, resolved] of [
 ['orange', 'dark', 'orange'], ['dark', 'light', 'dark'],
 ['system', 'light', 'orange'], ['system', 'dark', 'dark'],
 ['invalid', 'light', 'dark'],
] as const) {
 test(`@public-smoke first paint honors ${preference} with system ${system}`, async ({ page }) => {
  await page.emulateMedia({colorScheme: system});
  await page.addInitScript(pref => localStorage.setItem('gys:appearance:v1', pref), preference);
  // Hold React startup so the real initial HTML splash can be inspected.
  await page.route('**/src/main.tsx', route => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-gys-theme', resolved);
  const light = resolved === 'orange';
  await expect(page.locator('#splash')).toHaveCSS('background-color', light ? 'rgb(250, 247, 241)' : 'rgb(11, 11, 11)');
  const logo = page.locator('#splash img:visible');
  await expect(logo).toHaveCount(1);
  await expect(logo).toHaveAttribute('src', `/brand/wordmark-stacked-${light ? 'light' : 'dark'}.svg`);
  await expect.poll(() => logo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', light ? 'light' : 'dark');
 });
}

test('@public-smoke startup survives unavailable browser storage', async ({page}) => {
 await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {get() { throw new Error('unavailable'); }}));
 await page.route('**/src/main.tsx', route => route.abort());
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-gys-theme', 'dark');
 await expect(page.locator('.splash-logo--dark')).toBeVisible();
});

for (const theme of ['orange', 'dark']) {
 test(`@public-smoke animated and unlock logos remain readable in ${theme}`, async ({page}) => {
  await page.addInitScript(value => localStorage.setItem('gys:appearance:v1', value), theme);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/e2e/fixtures/premium-ui.html?screen=startup');
  const light = theme === 'orange';
  await expect(page.locator('img[alt="GetYourSats"]')).toHaveAttribute('src', `/brand/wordmark-stacked-${light ? 'light' : 'dark'}.svg`);
  for (const selector of ['.gys-brand-reveal__top', '.gys-brand-reveal__sats']) {
   await expect(page.locator(selector)).toHaveCSS('opacity','1');
   const part = selector.endsWith('__top') ? 'top' : 'bottom';
   await expect(page.locator(selector)).toHaveAttribute('src', `/brand/wordmark-${part}${light ? '-light' : ''}.svg`);
   await expect.poll(() => page.locator(selector).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.locator('.gys-brand-reveal__coin')).toHaveCSS('filter','none');
  await page.screenshot({path:`test-artifacts/startup-${theme}.png`});
 });
}

test('@public-smoke theme changes update home cards and History without reload', async ({page}) => {
 await page.setViewportSize({width:1366,height:936});
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
 await page.goto('/e2e/fixtures/premium-ui.html');
 const nav = page.getByRole('complementary', {name:'Wallet navigation'});
 await nav.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByTestId('settings-appearance-orange').click();
 await nav.getByRole('button',{name:'History',exact:true}).click();
 await expect(page.locator('.gys-activity')).toHaveCSS('background-color','rgb(255, 253, 248)');
 await expect(page.locator('.gys-history-controls input')).toHaveCSS('color','rgb(34, 27, 20)');
 await expect(page.getByTestId('transaction-amount')).toHaveCSS('color','rgb(23, 104, 63)');
 await page.screenshot({path:'test-artifacts/light-history.png',fullPage:true});
 await nav.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByTestId('settings-appearance-dark').click();
 await nav.getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-gys-theme','dark');
 await expect(page.locator('.gys-market-pulse__price')).toHaveCSS('color','rgb(248, 242, 230)');
 await nav.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByTestId('settings-appearance-system').click();
 await nav.getByRole('button',{name:'Wallet',exact:true}).click();
 await expect(page.locator('.gys-market-pulse')).toHaveCSS('background-color','rgb(255, 253, 248)');
 await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('html')).toHaveAttribute('data-gys-theme','dark');
 await expect(page.locator('.gys-market-pulse__price')).toHaveCSS('color','rgb(248, 242, 230)');
});
