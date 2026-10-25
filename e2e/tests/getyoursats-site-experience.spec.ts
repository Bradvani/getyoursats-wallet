import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';

const landing='http://localhost:5173/site/index.html';
// The production site is a separate Vercel project. Route its root-level
// static assets to source-controlled site files in the wallet repo's Vite QA.
test.beforeEach(async({page})=>{
 await page.route('**/experience-v4.js',route=>route.fulfill({
   contentType:'application/javascript',body:readFileSync('site/experience-v4.js','utf8')
 }));
 await page.route('**/experience-v4.css',route=>route.fulfill({
   contentType:'text/css',body:readFileSync('site/experience-v4.css','utf8')
 }));
});

for(const [width,height] of [[1440,900],[390,844],[320,700]]){
 test(`@public-smoke Experience v4 interactive journeys at ${width}px`,async({page})=>{
   const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
   await page.setViewportSize({width,height});
   await page.goto(landing,{waitUntil:'domcontentloaded'});
   await expect(page.locator('[data-ex-scene=wallet]')).toBeVisible();
   await expect(page.locator('link[rel=icon][type="image/svg+xml"]')).toHaveAttribute('href','/assets/favicon-light.svg?v=4');
   const tabs=page.locator('#features .feature-tab');await expect(tabs).toHaveCount(4);
   await page.locator('[data-ex-recovery=manual]').click();
   await page.locator('#ex-custody-next').click();
   await expect(page.locator('#ex-custody-copy')).toContainText('offline');
   await page.locator('#ex-custody-next').click();
   await expect(page.locator('#ex-custody-badge')).toBeVisible();
   await page.locator('#tab-lightning').click();
   await expect(page.locator('[data-ex-scene=lightning]')).toBeVisible();
   await page.locator('[data-ex-asset=USDT]').click();
   await expect(page.locator('#ex-source-caption')).toHaveText('USDT');
   await page.locator('#ex-route-reverse').click();
   await expect(page.locator('#ex-source-caption')).toHaveText('sats');
   await page.locator('#ex-route-preview').click();
   await expect(page.locator('#ex-route-note')).toContainText('No swap was performed');
   await page.locator('#tab-merchant').click();
   await expect(page.locator('#ex-merchant-sale')).toBeVisible();
   await page.locator('[data-ex-item=Goods]').click();
   await page.locator('#ex-merchant-invoice').click();
   await expect(page.locator('#ex-merchant-qr-view')).toContainText('Not a payable invoice');
   await page.locator('#ex-merchant-paid').click();
   await expect(page.locator('#ex-merchant-success')).toContainText('Payment received');
   await page.locator('#ex-merchant-new').click();
   await expect(page.locator('#ex-merchant-sale')).toBeVisible();
   await page.locator('#tab-stack').click();
   await expect(page.locator('[data-ex-scene=stack]')).toBeVisible();
   // Upcoming recurring buys must not advertise a functioning wallet CTA.
   await expect(page.locator('#features .feature-display-footer .circle-arrow')).toBeHidden();
   await page.locator('#tab-merchant').click();
   await expect(page.locator('#features .feature-display-footer .circle-arrow')).toBeVisible();
   await expect(page.locator('#features .feature-display-footer .circle-arrow')).toHaveAttribute('aria-label','Open the merchant POS inside the wallet');
   await page.locator('#tab-stack').click();
   await page.locator('#ex-stack-slider').evaluate((element:HTMLInputElement)=>{
     element.value='100';element.dispatchEvent(new Event('input',{bubbles:true}));
   });
   await expect(page.locator('#ex-stack-total')).toHaveText('$400 planned');
   await page.locator('[data-ex-frequency=month]').click();
   await expect(page.locator('#ex-stack-caption')).toHaveText('4 monthly contributions');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
   expect(errors).toEqual([]);
   mkdirSync('test-artifacts',{recursive:true});
   await page.locator('#features .feature-display').screenshot({
     path:`test-artifacts/experience-v4-${width}.png`,animations:'disabled'
   });
 });
}

test('@public-smoke keyboard feature tabs and preview-only controls stay accessible',async({page})=>{
 await page.goto(landing,{waitUntil:'domcontentloaded'});
 await page.locator('#tab-wallet').focus();
 await page.keyboard.press('ArrowDown');
 await expect(page.locator('#tab-lightning')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('[data-ex-scene=lightning]')).toBeVisible();
 await page.locator('#tab-merchant').click();
 await expect(page.locator('.ex-qr-art')).toBeHidden();
 await page.locator('#ex-merchant-invoice').click();
 await expect(page.locator('.ex-qr-art')).toHaveAttribute('aria-label','Decorative, non-scannable Lightning QR illustration');
});
