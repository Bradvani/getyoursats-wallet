import {test,expect,type Page} from '@playwright/test';
const origin='http://localhost:5173';
const fixture=origin+'/e2e/fixtures/gys-direct-payments.html';
const identity='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
type Evidence={sent:Array<{amount:string;id:string}>;lnurlSends:number};
const evidence=(page:Page)=>page.evaluate(()=>(window as unknown as {__gysDirectEvidence:()=>Evidence}).__gysDirectEvidence());
let available=true;
let lookupDelayMs=0;
test.beforeEach(async({context})=>{
  available=true;
  lookupDelayMs=0;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.href==='https://getyoursats.com/.well-known/gys/alice'&&lookupDelayMs)
      await new Promise(resolve=>setTimeout(resolve,lookupDelayMs));
    if(url.href==='https://getyoursats.com/.well-known/gys/alice')return route.fulfill({json:available?{
      available:true,lightningAddress:'alice@getyoursats.com',identityPublicKey:identity,sparkAddress:'spark1synthetic-browser-recipient',
      bindingId:'a'.repeat(64),expiresAt:Date.now()+60000,
    }:{available:false}});
    if(url.origin===origin&&!url.pathname.startsWith('/api/'))return route.continue();
    return route.abort('blockedbyclient');
  });
});
async function enter(page:Page,query=''){
  await page.goto(fixture+query);
  if(!query.includes('qr')){
    await page.getByTestId('payment-input').fill('alice@getyoursats.com');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
  }
  await expect(page.getByLabel('Amount',{exact:true})).toBeVisible();
  await page.getByLabel('Amount',{exact:true}).fill('100');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
}
for(const width of [360,390,768,1366]){
  test(`@public-smoke GYS address confirms a prepared zero quote at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:844});
    await enter(page);
    await expect(page.getByTestId('send-destination')).toHaveAttribute('title','alice@getyoursats.com');
    await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('0');
    await expect(page.getByTestId('send-confirm-button')).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath('gys-confirm-'+width+'.png'),animations:'disabled'});
    await page.getByTestId('send-confirm-button').dblclick();
    await expect.poll(()=>evidence(page)).toMatchObject({sent:[{amount:'100'}],lnurlSends:0});
    expect((await evidence(page)).sent[0].id).toMatch(/^[a-f0-9-]{36}$/);
  });
}
test('@public-smoke native receive QR uses the same free route',async({page})=>{
  await enter(page,'?qr');
  await expect(page.getByTestId('send-destination')).toHaveAttribute('title','alice@getyoursats.com');
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('0');
});
test('@public-smoke a slow verified recipient lookup still reaches a zero-fee review',async({page})=>{
  lookupDelayMs=6000;
  await page.goto(fixture);
  await page.getByTestId('payment-input').fill('alice@getyoursats.com');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Amount',{exact:true})).toBeVisible({timeout:12000});
  await page.getByLabel('Amount',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('0',{timeout:12000});
  await expect(page.getByTestId('send-confirm-button')).toBeEnabled();
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
});
for(const query of ['', '?qr']){
  test(`@public-smoke unavailable GYS routing reaches a paid review and explicit confirmation ${query||'address'}`,async({page},testInfo)=>{
    await page.setViewportSize({width:390,height:844});
    available=false;
    await enter(page,query);
    await expect(page.getByTestId('send-destination')).toHaveAttribute('title','alice@getyoursats.com');
    await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('3');
    await expect(page.getByText('Fee-free payment is unavailable right now. Please try again.')).toHaveCount(0);
    expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
    await page.screenshot({path:testInfo.outputPath('gys-lightning-fallback-review.png'),animations:'disabled'});
    await page.getByTestId('send-confirm-button').dblclick();
    await expect.poll(()=>evidence(page)).toEqual({sent:[],lnurlSends:1});
  });
}
test('@public-smoke a failed directory request still reaches Lightning fee review',async({page,context})=>{
  await context.route('https://getyoursats.com/.well-known/gys/alice',route=>route.abort('timedout'));
  await enter(page);
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('3');
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
});
test('@public-smoke test-network wallets never resolve a mainnet direct destination',async({page})=>{
  let resolutions=0;
  page.on('request',request=>{if(request.url().includes('/.well-known/gys/'))resolutions++;});
  await enter(page,'?network=regtest');
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('3');
  expect(resolutions).toBe(0);
});
test('@public-smoke a revoked binding requires a new fee review before payment',async({page})=>{
  await enter(page);available=false;
  await page.getByTestId('send-confirm-button').click();
  await expect(page.getByText('Recipient unavailable. Review the payment again.')).toBeVisible();
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
  await page.getByLabel('Amount',{exact:true}).fill('100');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('100');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('3');
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
});
test('@public-smoke a fee-bearing direct quote returns to Lightning review with the selected amount',async({page})=>{
  await enter(page,'?changedFee');
  await expect(page.getByTestId('send-confirm-button')).toHaveCount(0);
  await expect(page.getByLabel('Amount',{exact:true})).toHaveValue('100');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Network fee',{exact:true}).locator('..')).toContainText('3');
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
});
test('@public-smoke interrupted transfer survives reload and requires receipt reconciliation',async({page})=>{
  await enter(page,'?interrupted');await page.getByTestId('send-confirm-button').click();
  await expect.poll(()=>evidence(page)).toMatchObject({sent:[{amount:'100'}]});
  available=false;
  await page.reload();
  await page.getByTestId('payment-input').fill('alice@getyoursats.com');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Check payment history before sending again.')).toBeVisible();
  expect(await evidence(page)).toEqual({sent:[],lnurlSends:0});
  await page.goto(fixture+'?reconciled');
  await page.getByTestId('payment-input').fill('alice@getyoursats.com');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Check payment history before sending again.')).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('gys:payment-intent:')))).toEqual([]);
});
