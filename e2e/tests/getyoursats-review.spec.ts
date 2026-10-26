import {test,expect} from '@playwright/test';
for(const width of [360,390,768,1024,1366,1920])test(`wallet layout and history at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:936});
 await page.goto('/e2e/fixtures/premium-ui.html');
 await expect(page.getByTestId('send-button')).toBeVisible();
 await expect(page.getByTestId('receive-button')).toBeVisible();
 await expect(page.getByText('+5 000 sats')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 if(width>=1024){
  await expect(page.getByRole('complementary',{name:'Wallet navigation'})).toBeVisible();
  await expect(page.getByTestId('menu-button')).not.toBeVisible();
  await expect(page.locator('.gys-desktop-nav .gys-brand-wordmark')).toBeVisible();
  await expect(page.locator('.gys-wallet-balance-surface__toolbar .gys-app-header__identity')).not.toBeVisible();
  const box=await page.locator('.gys-wallet').boundingBox();expect(box!.width).toBeGreaterThan(width*.95);
  await page.getByRole('navigation').getByRole('button',{name:'History',exact:true}).first().click();
 }else{await page.getByRole('button',{name:/View full transaction history/}).click();}
 await expect(page.getByRole('heading',{name:'History',exact:true})).toBeVisible();
 await page.screenshot({path:`test-artifacts/review-wallet-${width}.png`,fullPage:true});
});
test('language choice is available before credentials are created',async({page})=>{
 await page.goto('/');await page.getByLabel('Language',{exact:true}).selectOption('hi');
 await expect(page.locator('html')).toHaveAttribute('lang','hi');
});
test('two-hundred-percent viewport-equivalent layout retains primary actions',async({page})=>{
 await page.setViewportSize({width:683,height:468});await page.goto('/e2e/fixtures/premium-ui.html');
 await expect(page.getByTestId('send-button')).toBeVisible();await expect(page.getByTestId('receive-button')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('Scan and merchant Accept follow active wallet language',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>localStorage.setItem('gys:language:v1','es'));
 await page.goto('/e2e/fixtures/premium-ui.html');
 await expect(page.getByTestId('scan-button')).toHaveText('Escanear');
 await expect(page.getByTestId('scan-button')).toHaveAttribute('aria-label','Escanear QR de pago');
 await expect(page.getByTestId('pos-button').locator('span').last()).toHaveText('Cobrar');
 await expect(page.getByTestId('pos-button')).toHaveAttribute('aria-label','Cobrar en modo comercio');
});

test('mobile drawer retains a compact set of working destinations without inactive promo rows', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.goto('/e2e/fixtures/premium-ui.html');
 await page.getByTestId('menu-button').click();
 const menu=page.getByRole('navigation',{name:'Wallet menu'});
 await expect(menu).toBeVisible();
 await expect(menu.getByRole('button',{name:'History'})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Scan QR'})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Point of Sale'})).toBeVisible();
 await expect(menu.getByRole('button',{name:'Settings'})).toBeVisible();
 await expect(menu.getByRole('button',{name:/Buy Bitcoin|Recurring Buys/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Remove wallet from this device'})).toBeVisible();
 await expect(page.getByTestId('menu-app-version')).toBeVisible();
 await expect(page.locator('.gys-feature-soon')).toHaveCount(0);
});

test('full history provides an obvious Back to Wallet control on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/e2e/fixtures/premium-ui.html');
 await page.getByRole('button',{name:/View full transaction history/}).click();
 await expect(page.getByRole('heading',{name:'History',exact:true})).toBeVisible();
 const back=page.getByRole('button',{name:'Back to Wallet'});
 await expect(back).toBeVisible();
 await expect(back).toHaveCSS('min-height','44px');
 await back.click();
 await expect(page.getByRole('heading',{name:'Recent payments'})).toBeVisible();
 await expect(back).not.toBeVisible();
});
