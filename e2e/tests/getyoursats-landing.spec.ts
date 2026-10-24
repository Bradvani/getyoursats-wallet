import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

test('@public-smoke responsive GetYourSats welcome is one cohesive surface',async ({page})=>{
  await page.setViewportSize({width:1365,height:820});
  await page.goto('http://localhost:5173/');
  // The initial HTML launch splash overlays React for a few frames.
  // Wait for the actual wallet landing to be visible before capturing.
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  await expect(page.getByRole('heading',{name:'Every sat counts.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Restore existing wallet'})).toBeVisible();
  expect(await page.locator('.gys-welcome__hero-mark').evaluate((x)=> (x as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:'test-artifacts/welcome-desktop.png',animations:'disabled'});
});
test('@public-smoke mobile wallet setup is passkey-first with one restore action',async ({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto('http://localhost:5173/');
  // The initial HTML launch splash overlays React for a few frames.
  // Wait for the actual wallet landing to be visible before capturing.
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await expect(page.getByRole('button',{name:'More recovery options'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Set up with an offline recovery phrase'})).toHaveCount(0);
  await expect(page.getByText('Create a wallet with a supported device passkey.',{exact:false})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  expect(overflow).toBe(false);
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:'test-artifacts/welcome-mobile.png',animations:'disabled',fullPage:true});
});

test('@public-smoke GetYourSats landing identity animates without affecting onboarding',async ({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('http://localhost:5173/');
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  await expect(page.locator('.gys-welcome__header img')).toHaveCount(0);
  await expect(page.getByText('21 MILLION. EVER.')).toBeVisible();
  await expect(page.locator('.gys-welcome__hero-mark')).toHaveAttribute('src','/brand/wordmark-3d-transparent.png');
  await expect(page.locator('.gys-welcome__hero-mark')).toHaveCSS('animation-name','gys-hero-arrive');
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Restore existing wallet'})).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.gys-welcome__hero-mark')).toHaveCSS('animation-duration','1e-05s');
});

test('@public-smoke iPhone browser has dismissible Add to Home Screen guidance above Start',async({browser})=>{
 const context=await browser.newContext({
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport:{width:390,height:844},
  isMobile:true,hasTouch:true
 });
 const page=await context.newPage();
 try{
  await page.goto('http://localhost:5173/');
  await expect(page.locator('#splash')).toHaveCount(0,{timeout:60000});
  const guidance=page.getByRole('region',{name:'Optional home-screen installation'});
  await expect(guidance).toBeVisible();
  await expect(guidance).toContainText('Add to Home Screen');
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  await page.getByRole('button',{name:'Dismiss installation guidance'}).click();
  await expect(guidance).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Start'})).toBeVisible();
  const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  expect(horizontalOverflow).toBe(false);
 }finally{await context.close()}
});
