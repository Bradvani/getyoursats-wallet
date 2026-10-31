import {test,expect} from '@playwright/test';
const fixture='/e2e/fixtures/premium-ui.html';
test.beforeEach(async({page})=>{
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/api/notifications/device',route=>route.fulfill({json:{available:false}}));
  await page.route('**/api/market-overview',route=>route.fulfill({json:{
    supply:{btc:20100000.125,updatedAt:Date.now()-60000},
    sentiment:{value:30,classification:'Fear',updatedAt:Date.now()-3600000},
  }}));
});

test('market information follows selected INR without changing Bitcoin amounts',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('gys:language:v1','en');
    localStorage.setItem('fiat_settings_v1',JSON.stringify({selectedCurrencies:['INR','USD']}));
    localStorage.setItem('display_fiat_currency','INR');
  });
  await page.setViewportSize({width:390,height:844});await page.goto(fixture);
  // Choose using the actual shared preference function, as Settings does.
  await page.evaluate(async()=>{const path='/src/services/settings.ts';const settings=await import(path);settings.setDisplayFiatCurrency('INR');});
  await expect(page.getByTestId('market-cap')).toContainText('₹15,07,50,00,09,37,500.00');
  await expect(page.getByTestId('market-supply')).toContainText('2,01,00,000.13 BTC');
  await expect(page.getByTestId('market-sentiment')).toContainText('30/100Fear');
  const cap=await page.getByTestId('market-cap').innerText();
  await page.getByTestId('market-unit-1k').click();
  await expect(page.getByTestId('market-cap')).toHaveText(cap);
  await expect(page.getByTestId('sats-balance-mark')).toBeVisible();
  const sats=page.getByRole('button',{name:'sats',exact:true}).first();
  await expect(sats).toHaveText('SATS');await expect(sats.locator('svg')).toHaveCount(0);
  await page.getByTestId('market-overview').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-artifacts/premium-market-inr.png'});
});

test('unavailable or stale feed never creates a zero cap or a false neutral sentiment',async({page})=>{
  await page.route('**/api/market-overview',route=>route.fulfill({json:{
    supply:{btc:20100000,updatedAt:Date.now()-86400000},sentiment:null,
  }}));
  await page.goto(fixture);
  await expect(page.getByTestId('market-cap')).toHaveText('Unavailable');
  await expect(page.getByTestId('market-sentiment')).toHaveText('Unavailable');
  await expect(page.getByTestId('market-quote-price')).toContainText('$90,000.00');
});

test('settings identity, social links and preference destinations work and persist',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(fixture+'?screen=settings');
  await expect(page.getByTestId('settings-gys-address')).toContainText('preview@getyoursats.com');
  await expect(page.getByRole('button',{name:'Verify Email Address'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/X \(Twitter\)/})).not.toBeVisible();
  await page.getByTestId('settings-wallet-guide').locator('summary').first().click();
  await expect(page.getByRole('link',{name:/X \(Twitter\)/})).toHaveAttribute('href','https://x.com/getyoursats');
  await expect(page.getByRole('link',{name:/ChainReaction/})).toHaveAttribute('href','https://www.instagram.com/getyoursats/');
  await page.getByTestId('settings-appearance').click();
  await page.getByRole('radio',{name:'Orange',exact:true}).check();
  await expect(page.locator('html')).toHaveAttribute('data-gys-theme','orange');
  await page.getByRole('button',{name:'Go back'}).click();
  await expect(page.getByTestId('settings-appearance')).toContainText('Orange');
  await page.getByTestId('settings-language').click();
  await page.getByRole('radio',{name:/Español/}).check();
  await expect(page.locator('html')).toHaveAttribute('lang','es');
  await page.reload();await expect(page.getByTestId('settings-language')).toContainText('Español');
  await expect(page.getByTestId('settings-appearance')).toContainText('Naranja');
  await page.screenshot({path:'test-artifacts/premium-settings-es.png'});
});

for(const language of ['en','hi','ar','ta'])test(`market and preference pages reflow at 320px and 200% text in ${language}`,async({page})=>{
  await page.addInitScript(lang=>localStorage.setItem('gys:language:v1',lang),language);
  await page.setViewportSize({width:320,height:740});await page.goto(fixture+'?screen=settings');
  await page.addStyleTag({content:'html{font-size:32px!important}'});
  await page.getByTestId('settings-appearance').click();
  const surface=page.locator('.gys-page-surface').last();
  expect(await surface.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(page.getByTestId('settings-appearance-system')).toBeEnabled();
  await page.goto(fixture);await page.addStyleTag({content:'html{font-size:32px!important}'});
  await page.getByTestId('market-overview').scrollIntoViewIfNeeded();
  // The price card has a deliberately clipped decorative pseudo-element and a horizontally scrollable denomination rail.
  // Measure the actual new information surface and page reflow, not those intentional overflow areas.
  const geometry=await page.getByTestId('market-overview').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  expect(geometry.scroll,JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const angle of [90,270])test(`scanner preserves its portrait surface when a phone tilts to ${angle} degrees`,async({page})=>{
  await page.addInitScript(()=>{
    const match=window.matchMedia.bind(window);
    window.matchMedia=query=>query==='(pointer: coarse)'?new Proxy(match(query),{get:(target,key)=>key==='matches'?true:Reflect.get(target,key)}):match(query);
    const orientation=Object.assign(new EventTarget(),{angle:0});
    Object.defineProperty(screen,'orientation',{configurable:true,value:orientation});
    Object.defineProperty(screen,'width',{configurable:true,value:390});
    Object.defineProperty(screen,'height',{configurable:true,value:844});
    (window as unknown as {tilt:(angle:number)=>void}).tilt=angle=>{orientation.angle=angle;orientation.dispatchEvent(new Event('change'));};
  });
  await page.setViewportSize({width:390,height:844});await page.goto('/e2e/fixtures/scan-send.html');
  await page.getByTestId('send-button').click();
  await page.getByRole('button',{name:'Scan QR',exact:true}).click();
  const scanner=page.getByTestId('scanner-portrait');await expect(scanner).toBeVisible();
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(value=>(window as unknown as {tilt:(angle:number)=>void}).tilt(value),angle);
  await expect.poll(()=>scanner.evaluate(el=>({w:el.clientWidth,h:el.clientHeight}))).toEqual({w:390,h:844});
  await expect(scanner.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport();
  await scanner.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(scanner).toHaveCount(0);
});
