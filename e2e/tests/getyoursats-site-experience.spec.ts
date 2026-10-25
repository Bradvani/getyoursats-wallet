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
    // Static network coverage remains visible as assets and directions change.
    const grid=page.locator('.ex-chain-grid');
    await expect(grid).toBeVisible();
    await expect(grid.locator('.ex-chain-chip')).toHaveCount(13);
    await expect(page.locator('.ex-network-footnote')).toContainText('Routes vary by asset, direction and provider');
    await expect(page.locator('#ex-route-journey')).toHaveCount(0);
    await expect(page.locator('#ex-route-preview')).toHaveCount(0);
    await expect(page.locator('#ex-route-description')).toContainText('Send sats as USDT');

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

test('@public-smoke route network grid covers documented chain examples at every viewport',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [width,height] of [[1440,900],[390,844],[320,700]]){
  await page.setViewportSize({width,height});
  await page.goto(landing,{waitUntil:'domcontentloaded'});
  await page.locator('#tab-lightning').click();
  const grid=page.locator('.ex-chain-grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('.ex-chain-chip')).toHaveCount(13);
  for(const name of ['Ethereum','Base','Arbitrum','Optimism','Polygon','Avalanche','BNB Chain','Linea','Sei','Sonic','Unichain','Solana','Tron']){
   await expect(grid.getByText(name,{exact:true})).toBeVisible();
  }
  await page.locator('#ex-route-reverse').click();
  await expect(page.locator('#ex-route-pair')).toHaveText('SATS  →  USDC');
  await page.locator('[data-ex-asset="USDT"]').click();
  await expect(page.locator('#ex-route-pair')).toHaveText('SATS  →  USDT');
  await expect(grid.locator('.ex-chain-chip')).toHaveCount(13);
  await expect(page.locator('.ex-network-footnote a')).toHaveAttribute('href','https://wallet.getyoursats.com/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 expect(errors).toEqual([]);
});

test('@public-smoke reduced motion keeps the network listing readable without a timeline',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:320,height:700});
 await page.goto(landing,{waitUntil:'domcontentloaded'});
 await page.locator('#tab-lightning').click();
 await expect(page.locator('.ex-chain-grid .ex-chain-chip').first()).toHaveCSS('animation-name','none');
 await expect(page.locator('.ex-network-count')).toContainText('13 NETWORKS + MORE');
 await expect(page.locator('#ex-route-journey')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
