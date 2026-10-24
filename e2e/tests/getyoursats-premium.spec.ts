import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const fixture = 'http://localhost:5173/e2e/fixtures/premium-ui.html';
test.beforeEach(async ({ page }) => {
 page.setDefaultTimeout(10000);
 page.on('pageerror', error => console.error('Fixture runtime error:', error.message));
});
for (const [width,height] of [[390,844],[320,568],[1365,820]]) {
 test(`@public-smoke wallet layout and recovery access ${width}`, async ({page}) => {
  const errors:string[]=[];page.on('pageerror', e=>errors.push(e.message));
  await page.setViewportSize({width,height});
  await page.goto(fixture);
  await expect(page.getByRole('button',{name:'Send Bitcoin',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Receive Bitcoin',exact:true})).toBeVisible();
  const recovery = page.getByRole('button',{name:/Protect your Bitcoin/});
  await expect(recovery).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:`test-artifacts/wallet-${width}.png`,fullPage:true});
  await recovery.click();
  await expect(page.getByRole('heading',{name:'Recovery entry reached'})).toBeVisible();
  expect(errors).toEqual([]);
 });
}
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
  await page.screenshot({path:`test-artifacts/state-${state}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(fixture+'?screen=sending');
 await expect(page.locator('.gys-transfer__orbit')).toHaveCSS('animation-name','none');
 await expect(page.getByRole('status')).toHaveAttribute('aria-busy','true');
});
