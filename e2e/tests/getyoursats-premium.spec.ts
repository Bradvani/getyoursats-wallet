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
  const pos=page.getByRole('button',{name:'Open Point of Sale'});
  const recurring=page.getByRole('button',{name:'Recurring Buys coming soon'});
  await expect(pos).toBeVisible();
  await expect(recurring).toBeVisible();
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
 await expect(page.getByTestId('pos-received-motion').locator('img[src="/brand/monogram.svg"]')).toBeVisible();
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
  if(state!=='settings')await expect(page.locator('[data-motion-state]')).toBeVisible();
  if(state==='settings')await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  if(state==='received'){
   await expect(page.getByTestId('payment-received-moment')).toHaveCSS('opacity','1');
   await expect(page.getByTestId('payment-received-moment').locator('img[src="/brand/monogram.svg"]')).toBeVisible();
  }
  if(state==='sent'){
   await expect(page.getByTestId('payment-success').locator('img[src="/brand/monogram.svg"]')).toBeVisible();
  }
  await page.screenshot({path:`test-artifacts/state-${state}.png`,animations:'disabled'});
  if(state==='received'){
   await page.getByRole('button',{name:'Done',exact:true}).click();
   await expect(page.getByRole('button',{name:'Send Bitcoin',exact:true})).toBeVisible();
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(fixture+'?screen=sending');
 await expect(page.locator('.gys-transfer__orbit')).toHaveCSS('animation-name','none');
 await expect(page.getByRole('status')).toHaveAttribute('aria-busy','true');
 await page.goto(fixture+'?screen=received');
 await expect(page.getByTestId('payment-received-moment')).toBeVisible();
 await expect(page.locator('.gys-transfer--received .gys-transfer__glow')).toHaveCSS('display','none');
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
