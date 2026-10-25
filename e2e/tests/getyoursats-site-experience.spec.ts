import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';

// V5 is deployed to a separate static site, never the money-moving wallet.
// Root asset requests from the source-controlled HTML need to be supplied
// from the marketing files when Vite serves /site/index.html in CI.
const landing='http://localhost:5173/site/index.html';
test.beforeEach(async({page})=>{
  await page.route('**/experience-v5.js*',route=>route.fulfill({
    contentType:'application/javascript',body:readFileSync('site/experience-v5.js','utf8')
  }));
  await page.route('**/experience-v5.css*',route=>route.fulfill({
    contentType:'text/css',body:readFileSync('site/experience-v5.css','utf8')
  }));
});

for(const [width,height] of [[1440,900],[390,844],[320,700]]){
  test(`@public-smoke marketing Experience v5 and honest sats wheel at ${width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height});
    await page.goto(landing,{waitUntil:'domcontentloaded'});
    await expect(page.locator('[data-ex-scene=wallet]')).toBeVisible();
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]'))
      .toHaveAttribute('href','/assets/favicon-light.svg?v=4');
    await expect(page.locator('#features .feature-tab')).toHaveCount(4);
    await expect(page.locator('#preview-value')).toContainText('sats');
    // The hero illustrates a usable wallet, not a static marketing mock.
    await page.locator('[data-screen=send]').click();
    await expect(page.locator('.screen-panel-title')).toHaveText('Pay over Lightning.');
    await page.locator('[data-screen=activity]').click();
    await expect(page.locator('#hero-sats-story')).toHaveCount(1);

    // Reversing must change the source, destination and token identity.
    await page.locator('#tab-lightning').click();
    await expect(page.locator('[data-ex-scene=lightning]')).toBeVisible();
    await expect(page.locator('#ex-source-caption')).toHaveText('USDC');
    await expect(page.locator('#ex-target-caption')).toHaveText('sats');
    await page.locator('#ex-route-reverse').click();
    await expect(page.locator('#ex-source-caption')).toHaveText('sats');
    await expect(page.locator('#ex-target-caption')).toHaveText('USDC');
    await expect(page.locator('#ex-route-track')).toHaveAttribute('data-direction','sats-out');
    await expect(page.locator('#ex-route-track')).not.toHaveClass(/is-reversed/);
    await page.locator('[data-ex-asset=USDT]').click();
    await expect(page.locator('#ex-target-caption')).toHaveText('USDT');
    await expect(page.locator('#ex-target-icon')).toHaveText('₮');
    await page.locator('#ex-route-preview').click();
    await expect(page.locator('#ex-route-journey')).toBeVisible();
    await expect(page.locator('#ex-route-note')).toBeHidden();
    await expect(page.locator('#ex-route-step-title')).toContainText('Find sats → USDT');
    await page.locator('[data-route-step="2"]').click();
    await expect(page.locator('#ex-route-step-title')).toContainText('Flashnet');
    await expect(page.locator('#ex-route-step-body')).toContainText('on-Spark leg atomically');
    await page.locator('[data-route-step="3"]').click();
    await expect(page.locator('#ex-route-step-body')).toContainText('pending');
    await expect(page.locator('.ex-route-safety')).toContainText('External-chain delivery');

    // This is a distinct, non-payable story; the real counter is below.
    await page.locator('#tab-merchant').click();
    await expect(page.locator('[data-ex-scene=merchant] .pos-quick-item')).toHaveCount(0);
    await page.locator('[data-ex-film-beat="2"]').click();
    await expect(page.locator('#ex-film-wallet-heading')).toContainText('Confirmed');
    await page.locator('#ex-film-replay').click();
    await expect(page.locator('#ex-film-state')).toHaveText('01 / INVOICE');

    // Coming-soon DCA is a rolling illustration, not a working buy control.
    await page.locator('#tab-stack').click();
    await expect(page.locator('[data-ex-scene=stack] input[type=range]')).toHaveCount(0);
    await expect(page.locator('#features .feature-display-footer .circle-arrow')).toBeHidden();
    await page.locator('[data-ex-frequency=month]').click();
    await expect(page.locator('#ex-stack-period')).toHaveText('every month');
    await page.locator('#ex-stack-pause').click();
    await expect(page.locator('#ex-stack-pause')).toHaveText('Play');

    // Linear supply progress: each 25m sats is exactly 25% of the ring.
    for(const [sats,percent] of [[1,'<1%'],[25000000,'25%'],[50000000,'50%'],[75000000,'75%'],[100000000,'100%']] as const){
      await page.locator('#sats-slider').evaluate((element:HTMLInputElement,value:number)=>{
        element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));
      },sats);
      await expect(page.locator('#sats-amount'))
        .toHaveText(`${Number(sats).toLocaleString('en-US')} ${sats===1?'sat':'sats'}`);
      await expect(page.locator('#sat-wheel-pct')).toHaveText(percent);
      const actual=await page.locator('#sat-orbit-wheel').evaluate(element=>
        parseFloat((element as HTMLElement).style.getPropertyValue('--wheel-progress'))
      );
      expect(Math.abs(actual-sats/1e6)).toBeLessThan(1e-6);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
    mkdirSync('test-artifacts',{recursive:true});
    if(width===390)await page.locator('#features .feature-display').screenshot({
      path:'test-artifacts/experience-v5-mobile.png',animations:'disabled'
    });
  });
}
test('@public-smoke merchant and DCA storytelling animates without creating payments',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(landing,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-stack').click();
  await expect(page.locator('#ex-stack-total')).toHaveText('$25');
  await expect(page.locator('#ex-stack-total')).toHaveText('$50',{timeout:5500});
  await page.locator('#ex-stack-replay').click();
  await expect(page.locator('#ex-stack-total')).toHaveText('$25');
  await page.locator('#tab-merchant').click();
  await expect(page.locator('#ex-film-state')).toHaveText('01 / INVOICE');
  await expect(page.locator('#ex-film-state')).toHaveText('02 / LIGHTNING',{timeout:6000});
});
test('@public-smoke reduced motion, accessible feature tabs and CTA accuracy',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(landing,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-wallet').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#tab-lightning')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-ex-scene=lightning]')).toBeVisible();
  await page.locator('#tab-merchant').click();
  await expect(page.locator('#ex-film-state')).toHaveText('03 / VERIFIED');
  await expect(page.locator('#features .feature-display-footer .circle-arrow')).toBeVisible();
  await page.locator('#tab-stack').click();
  await expect(page.locator('#ex-stack-total')).toHaveText('$100');
  await expect(page.locator('#features .feature-display-footer .circle-arrow')).toBeHidden();
  await expect(page.locator('.ex-stack-motion-coin')).toHaveCSS('animation-name','none');
});

test('@public-smoke Bitcoin-first route storyboard separates atomic Spark conversion from external delivery',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(landing,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-lightning').click();
  const panel=page.locator('#ex-route-journey');
  await expect(panel).toBeHidden();
  await page.locator('#ex-route-preview').click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#ex-route-preview')).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#ex-route-progress')).toHaveText('01 / 04');
  await expect(page.locator('#ex-route-step-title')).toContainText('USDC → sats');
  await expect(page.locator('#ex-route-progress')).toHaveText('04 / 04',{timeout:7600});
  await expect(page.locator('#ex-route-step-body')).toContainText('pending');
  await page.locator('#ex-route-reverse').click();
  await expect(page.locator('#ex-journey-from')).toHaveText('SATS');
  await expect(page.locator('#ex-journey-to')).toHaveText('USDC');
  await page.locator('[data-ex-asset=USDT]').click();
  await expect(page.locator('#ex-journey-to')).toHaveText('USDT');
  await page.locator('[data-route-step="2"]').click();
  await expect(page.locator('[data-route-step="2"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#ex-route-provider')).toContainText('FLASHNET');
  await expect(page.locator('#ex-route-step-body')).toContainText('atomically');
  await page.locator('#ex-route-preview').click();
  await expect(page.locator('#ex-route-progress')).toHaveText('01 / 04');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});

test('@public-smoke reduced motion shows readable final delivery stage without autoplay',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:700});
  await page.goto(landing,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-lightning').click();
  await page.locator('#ex-route-preview').click();
  await expect(page.locator('#ex-route-progress')).toHaveText('04 / 04');
  await expect(page.locator('.ex-route-journey-line i').first()).toHaveCSS('animation-name','none');
  await page.locator('[data-route-step="1"]').click();
  await expect(page.locator('#ex-route-progress')).toHaveText('02 / 04');
  await expect(page.locator('#ex-route-step-title')).toContainText('approve');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
