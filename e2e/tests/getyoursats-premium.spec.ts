import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const fixture = 'http://localhost:5173/e2e/fixtures/premium-ui.html';
test.beforeEach(async ({ page }) => {
 page.setDefaultTimeout(10000);
 page.on('pageerror', error => console.error('Fixture runtime error:', error.message));
});
for (const [width,height] of [[390,844],[320,568],[1365,820]]) {
 test(`@public-smoke wallet home quick actions and safe layouts ${width}`, async ({page}) => {
  const errors:string[]=[];page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width,height});
  await page.goto(fixture);
  await expect(page.getByRole('button',{name:'Send Bitcoin',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Receive Bitcoin',exact:true})).toBeVisible();
  await expect(page.getByTestId('wallet-balance')).toHaveText(/125\s*000/);
  const pos=page.getByRole('button',{name:width>=1024?'Merchant mode':'Open Point of Sale',exact:true});
  const recurring=page.locator('button[aria-label="Recurring Buys coming soon"]');
  await expect(pos).toBeVisible();
  if(width<1024)await expect(recurring).toBeVisible();
  else await expect(recurring).not.toBeVisible();
  await expect(page.getByRole('button',{name:/Protect your Bitcoin|Review recovery options/})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:`test-artifacts/wallet-${width}.png`,fullPage:true,animations:'disabled'});
  await expect(recurring).toBeDisabled();
  await pos.click();
  const terminal=page.getByRole('dialog',{name:'Merchant point of sale'});
  await expect(terminal).toBeVisible();
  await terminal.getByRole('button',{name:'1',exact:true}).click();
  await terminal.getByRole('button',{name:'Charge',exact:true}).click();
  const paymentQr=page.getByTestId('pos-invoice-qr');
  await expect(paymentQr.locator('svg')).toBeVisible();
  await expect(paymentQr.locator('img[src="/brand/monogram.svg"]')).toBeVisible();
  await page.getByRole('button',{name:'Close point of sale'}).click();
  expect(errors).toEqual([]);
 });
}
test('@public-smoke Bitcoin market is visible before transactions with scrollable sats prices',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture);
 const market=page.getByTestId('bitcoin-market');
 await expect(market).toBeVisible();
 // The market reference now appears before activity in DOM/visual order,
 // instead of a collapsed <details> after the transaction list.
 const beforeActivity=await page.evaluate(()=>{
   const market=document.querySelector('[data-testid="bitcoin-market"]');
   const activity=document.querySelector('.gys-activity');
   return Boolean(market&&activity&&(market.compareDocumentPosition(activity)&Node.DOCUMENT_POSITION_FOLLOWING));
 });
 expect(beforeActivity).toBe(true);
 await expect(market.getByTestId('market-quote-price')).toHaveText('$90,000.00');
 const units=market.locator('.gys-market-pulse__denominations');
 await expect(units).toBeVisible();
 await market.getByTestId('market-unit-1k').click();
 await expect(market.getByTestId('market-quote-price')).toHaveText('$0.90');
 await market.getByTestId('market-unit-10k').click();
 await expect(market.getByTestId('market-quote-price')).toHaveText('$9.00');
 await market.getByTestId('market-unit-100k').click();
 await expect(market.getByTestId('market-quote-price')).toHaveText('$90.00');
 await market.getByTestId('market-unit-1m').click();
 await expect(market.getByTestId('market-quote-price')).toHaveText('$900.00');
 await market.getByTestId('market-unit-10m').click();
 await expect(market.getByTestId('market-quote-price')).toHaveText('$9,000.00');
 await expect(market.getByTestId('market-unit-10m')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.reload();
 await expect(page.getByTestId('market-unit-10m')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('market-quote-price')).toHaveText('$9,000.00');
});

test('@public-smoke merchant shows lightning flash only after an SDK confirmed receipt',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture);
 await page.getByRole('button',{name:'Open Point of Sale'}).click();
 const terminal=page.getByRole('dialog',{name:'Merchant point of sale'});
 await terminal.getByRole('button',{name:'1',exact:true}).click();
 await terminal.getByRole('button',{name:'Charge',exact:true}).click();
 await expect(page.getByTestId('pos-invoice-qr').locator('svg')).toBeVisible();
 await expect(page.getByTestId('pos-received-motion')).toHaveCount(0);
 await expect(terminal).toContainText('Waiting for payment confirmation');
 // A click on Charge must NOT simulate a payment. Only the dev-only fixture
 // dispatch of the SDK's paymentSucceeded event is allowed to settle it.
 await page.evaluate(()=>{
  (window as Window & {__gysFixtureSettlePos?:()=>void}).__gysFixtureSettlePos?.();
 });
 await expect(page.getByTestId('pos-received-motion')).toBeVisible();
 await expect(page.getByTestId('pos-received-motion').locator('[data-motion-state="received"]')).toBeVisible();
 // Payment artwork is now crisp inline SVG; the invoice QR retains its image.
 const mark=page.getByTestId('pos-received-motion').locator('svg.gys-contour-mark');
 await expect(mark).toBeVisible();
 await expect(mark.locator('image,img')).toHaveCount(0);
 await expect(mark).toHaveAttribute('viewBox','0 0 512 512');
 await expect(page.getByTestId('pos-invoice-qr')).toHaveCount(0);
 await expect(terminal).toContainText('Payment confirmed by the wallet');
 await page.screenshot({path:'test-artifacts/pos-payment-received.png',animations:'disabled'});
 await terminal.getByRole('button',{name:'New charge'}).click();
 await expect(page.getByTestId('pos-received-motion')).toHaveCount(0);
});

test('@public-smoke send receive settings and reduced motion',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture);
 await page.getByRole('button',{name:'Receive Bitcoin',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Receive',exact:true})).toBeVisible();
 await page.screenshot({path:'test-artifacts/receive-mobile.png'});
 await page.goto(fixture);
 await page.getByRole('button',{name:'Send Bitcoin',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Send BTC or USD',exact:true})).toBeVisible();
 await page.screenshot({path:'test-artifacts/send-mobile.png'});
 for(const state of ['sending','converting','receiving','sent','failed','received','settings']){
  await page.goto(fixture+'?screen='+state);
  if(state!=='settings'&&state!=='received')await expect(page.locator('[data-motion-state]')).toBeVisible();
  if(state==='settings')await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  if(state==='received'){
   // The integrated receive scene is portalled, not nested in its event owner.
   await expect(page.getByTestId('payment-received-moment')).toBeAttached();
   const scene=page.getByTestId('transfer-experience');
   await expect(scene).toBeVisible();
   await expect(scene).toHaveAttribute('data-phase','confirmed');
   await expect(scene).toHaveAttribute('data-direction','received');
   await expect(scene.locator('svg.gys-contour-mark')).toBeVisible();
   await expect(scene.locator('.gys-contour-mark image,.gys-contour-mark img')).toHaveCount(0);
   await expect(scene.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
  }
  if(state==='sent'){
   const mark=page.getByTestId('payment-success').locator('svg.gys-contour-mark');
   await expect(mark).toBeVisible();
   await expect(mark.locator('image,img')).toHaveCount(0);
  }
  await page.screenshot({path:`test-artifacts/state-${state}.png`,animations:'disabled'});
  if(state==='received'){
   await page.getByRole('button',{name:'Done',exact:true}).click();
   await expect(page.getByRole('button',{name:'Send Bitcoin',exact:true})).toBeVisible();
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(fixture+'?screen=sending');
 await expect(page.locator('.gys-contour-mark')).toBeVisible();
 await expect(page.locator('.gys-contour-mark')).toHaveCSS('animation-name','none');
 await expect(page.locator('.gys-pulse__contours')).toBeHidden();
 await expect(page.getByRole('status')).toHaveAttribute('aria-busy','true');
 await page.goto(fixture+'?screen=received');
 await expect(page.getByTestId('payment-received-moment')).toBeAttached();
 const reducedScene=page.getByTestId('transfer-experience');
 await expect(reducedScene).toBeVisible();
 await expect(reducedScene.locator('.gys-sequence__canvas')).toBeHidden();
 await expect(reducedScene.locator('.gys-contour-mark')).toHaveCSS('animation-name','none');
 await expect(reducedScene.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
});

test('@public-smoke installed iOS header keeps the official wordmark clear',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture);
 await page.evaluate(()=>document.documentElement.classList.add('ios-standalone-bottom-gap'));
 const logo=page.locator('.gys-wallet-balance-surface__toolbar img.gys-brand-wordmark--compact');
 await expect(logo).toBeVisible();
 await expect(logo).toHaveAttribute('src','/brand/wordmark-horizontal-dark.svg');
 await expect(logo).toHaveCSS('opacity','1');
 const veil=page.locator('.gys-wallet-balance-surface__veil');
 await expect(veil).toHaveCSS('backdrop-filter','none');
 const image=await logo.evaluate((img)=>{
  const el=img as HTMLImageElement;
  const box=el.getBoundingClientRect();
  const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
  return {width:el.naturalWidth,top:box.top,height:box.height,unobstructed:hit===el||el.contains(hit)};
 });
 expect(image.width).toBeGreaterThan(0);
 expect(image.top).toBeGreaterThanOrEqual(0);
 expect(image.height).toBeGreaterThan(20);
 expect(image.unobstructed).toBe(true);
});
test('@public-smoke recovery requires the Settings route',async({page})=>{
 await page.goto(fixture);
 await expect(page.getByRole('button',{name:/Protect your Bitcoin|Review recovery options/})).toHaveCount(0);
 await page.goto(fixture+'?screen=settings');
 await page.getByRole('button',{name:/Recovery words/}).click();
 await expect(page.getByRole('heading',{name:'Recovery entry reached'})).toBeVisible();
});
