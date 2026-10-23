import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

test('@public-smoke responsive GetYourSats welcome is one cohesive surface',async ({page})=>{
  await page.setViewportSize({width:1365,height:820});
  await page.goto('http://localhost:5173/');
  // The initial HTML launch splash overlays React for a few frames.
  // Wait for the actual wallet landing to be visible before capturing.
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  await expect(page.getByRole('heading',{name:'Bitcoin, on your terms.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Restore existing wallet'})).toBeVisible();
  await expect(page.locator('.gys-welcome__coin img')).toHaveCSS('mask-mode','luminance');
  expect(await page.locator('.gys-welcome__coin img').evaluate((x)=> (x as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:'test-artifacts/welcome-desktop.png',animations:'disabled'});
});
test('@public-smoke mobile layout has no overflow, duplicate recovery menu or seed prompt',async ({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('http://localhost:5173/');
  // The initial HTML launch splash overlays React for a few frames.
  // Wait for the actual wallet landing to be visible before capturing.
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await expect(page.getByRole('button',{name:'More recovery options'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Set up with an offline recovery phrase'})).toHaveCount(0);
  await expect(page.getByText('Start with a device passkey.',{exact:false})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  expect(overflow).toBe(false);
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:'test-artifacts/welcome-mobile.png',animations:'disabled',fullPage:true});
});

test('@public-smoke branded welcome actually animates when motion is allowed', async ({page}) => {
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('http://localhost:5173/');
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  const coin = page.locator('.gys-welcome__coin');
  await expect(coin).toBeVisible();
  await expect(coin).toHaveCSS('animation-name','gys-coin-float');
  await expect(page.locator('.gys-welcome__start')).toHaveCSS('transition-property',/transform/);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(coin).toHaveCSS('animation-name','none');
});
