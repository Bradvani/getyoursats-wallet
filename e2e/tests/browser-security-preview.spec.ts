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
  await page.getByRole('button',{name:'Receive Bitcoin',exact:true}).click();
  await page.getByTestId('usd-tab').click();
  await expect(page.getByText('Stablecoin receiving is temporarily unavailable in this security preview. No deposit address has been created.')).toBeVisible();
  await expect(page.getByText('Requested amount',{exact:true})).toHaveCount(0);
  await page.getByTestId('btc-tab').click();
  await expect(page.getByText('Stablecoin receiving is temporarily unavailable in this security preview. No deposit address has been created.')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 });
}
