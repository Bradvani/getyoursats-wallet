import {test,expect} from '@playwright/test';

// UI-only fixture: no SDK wallet, user credentials or funds.
test.use({trace:'off',video:'off',screenshot:'off'});
for(const width of [390,768,1366]){
 test(`security preview states are explicit at ${width}px`,async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});
  await page.goto('/e2e/fixtures/premium-ui.html?securityPreview=yes');
  await expect(page.getByText('Security preview — live synchronization unavailable.')).toBeVisible();
  await expect(page.getByText('Balance and history may be out of date. Use disposable test wallets only.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Copy your Lightning address'})).toHaveCount(0);
  await expect(page.getByText('preview@example.invalid',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Receive Bitcoin',exact:true}).click();
  await expect(page.getByTestId('lightning-address-text')).toHaveCount(0);
  await expect(page.getByTestId('show-amount-panel-button')).toHaveCount(0);
  await page.getByTestId('bitcoin-tab').click();
  await expect(page.getByText('Bitcoin receiving is unavailable in this security preview. Do not fund existing deposit addresses.')).toBeVisible();
  await expect(page.getByTestId('bitcoin-address-text')).toHaveCount(0);
  // Allow the old 300ms address prewarm to run if containment regresses.
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>(window as Window&{__gysFixtureReceiveRequests?:string[]}).__gysFixtureReceiveRequests)).toEqual([]);
  await page.getByTestId('usd-tab').click();
  await expect(page.getByText('Stablecoin receiving is temporarily unavailable in this security preview. No deposit address has been created.')).toBeVisible();
  await expect(page.getByText('Requested amount',{exact:true})).toHaveCount(0);
  await page.getByTestId('btc-tab').click();
  await expect(page.getByText('Stablecoin receiving is temporarily unavailable in this security preview. No deposit address has been created.')).toHaveCount(0);
  await page.getByTestId('direct-spark-receive-entry').click();
  await expect(page.getByTestId('spark-address-text')).toBeVisible();
  expect(await page.evaluate(()=>(window as Window&{__gysFixtureReceiveRequests?:string[]}).__gysFixtureReceiveRequests)).toEqual(['sparkAddress']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 });
}
