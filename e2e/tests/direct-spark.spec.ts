import {test,expect} from '@playwright/test';
import {flowText} from '../../src/locales/flowText';
import completion from '../../src/locales/flowCompletion.json' with {type:'json'};
import type {AppLanguage} from '../../src/services/presentationPreferences';

const address='spark1disposable_TEST_01';
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='localhost'?route.continue():route.abort());
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:320,height:740});
});
for(const language of Object.keys(completion) as AppLanguage[])test('explicit direct receive route in '+language,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const t=(key:string)=>flowText(language,key);
 await page.goto('/e2e/fixtures/direct-spark.html?lang='+language);
 const entry=page.getByTestId('direct-spark-receive-entry');
 await expect(entry).toContainText(t('Pay me directly on Spark · 0 sats transfer fee'));
 await entry.click();
 const panel=page.getByTestId('direct-spark-receive-panel');
 await expect(panel.getByTestId('spark-address-text')).toContainText(address);
 await expect(panel).toContainText(t('Spark addresses can be reused and linked across payments. Share this address only with people you trust.'));
 await expect(panel).toContainText(t('Another Spark-compatible wallet can send Bitcoin here with no Spark transfer fee. This is not a Lightning invoice. Lightning Address payments can still incur routing fees.'));
 await expect(page.getByTestId('lightning-invoice-text')).toHaveCount(0);
 const calls=JSON.parse(await page.getByTestId('fixture-calls').textContent()||'{}');
 expect(calls).toEqual({receive:['sparkAddress'],prepared:[],sent:[],lnurl:0});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(['ar','ta','ja'].includes(language))await page.screenshot({path:`test-artifacts/direct-spark-${language}-320.png`});
 await panel.getByRole('button',{name:t('Back to receive options'),exact:true}).click();
 await expect(entry).toBeVisible();
 expect(errors).toEqual([]);
});
test('failed receive request has no empty QR and can retry',async({page})=>{
 await page.goto('/e2e/fixtures/direct-spark.html?lang=en&fail=1');
 await page.getByTestId('direct-spark-receive-entry').click();
 const panel=page.getByTestId('direct-spark-receive-panel');
 await expect(panel.getByRole('alert')).toContainText('disposable fixture');
 await expect(panel.getByTestId('spark-address-text')).toHaveCount(0);
 await panel.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(panel.getByTestId('spark-address-text')).toContainText(address);
 expect(JSON.parse(await page.getByTestId('fixture-calls').textContent()||'{}').receive).toEqual(['sparkAddress','sparkAddress']);
});
for(const fee of [0,7])test(`direct send preserves recipient amount and adds the ${fee} sat quote`,async({page})=>{
 await page.goto('/e2e/fixtures/direct-spark.html?lang=en&mode=send&fee='+fee);
 await page.getByTestId('payment-input').fill(address);
 await page.getByTestId('continue-button').click();
 await page.getByTestId('amount-input').fill('1000');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByTestId('send-destination')).toHaveAttribute('title',address);
 const total=page.getByText('Total deducted',{exact:true}).locator('..');
 await expect(total).toContainText(fee===0?'1 000':'1 007');
 await page.getByTestId('send-confirm-button').click();
 await expect(page.getByTestId('payment-success')).toBeVisible();
 expect(JSON.parse(await page.getByTestId('fixture-calls').textContent()||'{}')).toEqual({
  receive:[],prepared:[{destination:address,amount:'1000'}],sent:[{destination:address,amount:'1000',fee:String(fee)}],lnurl:0,
 });
});
