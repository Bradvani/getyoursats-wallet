import {test,expect} from '@playwright/test';
const url='/e2e/fixtures/stable-mode.html';
async function changes(page:import('@playwright/test').Page){return page.evaluate(()=>(window as unknown as {__stableModeFixture:{changes:unknown[]}}).__stableModeFixture.changes);}
test('balance units cannot invoke a conversion; Settings requires a fresh cost acknowledgement',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(url);
 await expect(page.getByTestId('balance-holding-label')).toBeVisible();await expect(page.getByRole('button',{name:/Switch balance to/})).toHaveCount(0);
 await page.getByTestId('balance-holding-label').click();expect(await changes(page)).toEqual([]);await expect(page.getByTestId('stable-mode-warning')).toHaveCount(0);
 await page.getByRole('button',{name:'Open Settings'}).click();await page.getByTestId('review-balance-mode').click();
 const warning=page.getByTestId('stable-mode-warning');await expect(warning).toContainText('Switching back does not refund');
 const review=warning.getByRole('button',{name:'Review estimated cost'});await expect(review).toBeDisabled();await warning.getByRole('checkbox').check();await review.click();
 const confirm=page.getByRole('button',{name:'Confirm balance mode'});await expect(confirm).toBeEnabled();expect(await changes(page)).toEqual([]);
 await confirm.click();await expect.poll(()=>changes(page)).toEqual(['USDB']);
});
test('existing USDB stays accessible but never auto-converts on startup or cancellation',async({page})=>{
 await page.goto(url+'?stable');await expect(page.getByTestId('balance-holding-label')).toHaveText('USDB');expect(await changes(page)).toEqual([]);
 await page.getByRole('button',{name:'Open Settings'}).click();await page.getByRole('button',{name:'Review conversion to Bitcoin'}).click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await changes(page)).toEqual([]);
});
test('restored USDB produces a notice, never an automatic conversion prompt',async({page})=>{
 await page.goto(url+'?detected');await expect(page.getByTestId('detected-usdb-notice')).toContainText('USDB funds detected');
 await expect(page.getByTestId('stable-mode-warning')).toHaveCount(0);expect(await changes(page)).toEqual([]);
});
test('quote failure keeps conversion unavailable without changing holdings',async({page})=>{
 await page.goto(url+'?settings&quote-error');await page.getByTestId('review-balance-mode').click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Review estimated cost'}).click();
 await expect(page.getByRole('alert')).toContainText('Nothing was changed');await expect(page.getByRole('button',{name:'Confirm balance mode'})).toBeDisabled();expect(await changes(page)).toEqual([]);
});
for(const language of ['en','hi','es','pt','ja','th','vi','ta','ar','zh-CN'])test('stable support follows language '+language,async({page})=>{
 await page.goto('/support.html?lang='+language+'#stable-mode');await expect(page.locator('#stable-mode')).toHaveAttribute('lang',language);
 await expect(page.locator('#stable-mode')).toContainText('USDB');await expect(page.locator('#stable-mode p')).toHaveCount(5);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
for(const language of ['en','ar','ta'])test('conversion review remains reachable on a small phone: '+language,async({page})=>{
 await page.setViewportSize({width:320,height:568});await page.addInitScript(lang=>localStorage.setItem('gys:language:v1',lang),language);
 await page.goto(url+'?settings');await page.getByTestId('review-balance-mode').click();
 const warning=page.getByTestId('stable-mode-warning');await expect(warning).toBeVisible();await warning.getByRole('checkbox').check();
 const review=warning.locator('button').last();await review.scrollIntoViewIfNeeded();await expect(review).toBeInViewport();await review.click();
 await expect(page.getByTestId('stable-mode-review')).toBeVisible();expect(await changes(page)).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
