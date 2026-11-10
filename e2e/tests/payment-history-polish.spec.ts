import {test,expect} from '@playwright/test';

for(const theme of ['orange','dark'])for(const width of [320,390,1366]){
  test(`History identifies outgoing payments without inventing senders: ${theme} ${width}`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.route('https://**/*',route=>route.abort());
    await page.route('**/api/notifications/device',route=>route.fulfill({json:{available:false}}));
    await page.goto(`/e2e/fixtures/android-audit.html?theme=${theme}&entry=existing&balance=1&named=1&complete=1&counterparties=1`);
    const history=page.getByRole('region',{name:'History'});
    await expect(history.getByText('Recipient: shiv@getyoursats.com')).toBeVisible();
    await expect(history.getByText('GetYourSats payment',{exact:false})).toBeVisible();
    await expect(history.getByText('Sender not shared').first()).toBeVisible();
    await expect(history.getByText('Spark',{exact:false})).toHaveCount(0);
    await history.getByRole('button',{name:/Sent payment.*shiv@getyoursats/}).click();
    await expect(page.getByText('shiv@getyoursats.com',{exact:true}).last()).toBeVisible();
    await expect(page.getByText('Recipient',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'View full transaction history'}).click();
    await page.getByRole('searchbox',{name:'Search transactions'}).fill('shiv@getyoursats.com');
    await expect(page.getByTestId('transaction-item')).toHaveCount(1);
    await expect(page.getByTestId('transaction-item')).toContainText('shiv@getyoursats.com');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
}

test('Orange market toggles repeatedly with reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/e2e/fixtures/android-audit.html?theme=orange&entry=existing&balance=1&complete=1');
  const toggle=page.getByTestId('open-bitcoin-market');
  for(let i=0;i<3;i++){
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(page.getByTestId('market-details')).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('market-details')).toBeHidden();
  }
});

test('Orange Bitcoin receive guidance and copy control have readable contrast',async({page})=>{
  await page.setViewportSize({width:320,height:568});
  await page.goto('/e2e/fixtures/android-audit.html?theme=orange&entry=existing&balance=1&complete=1');
  await page.getByRole('button',{name:'Receive Bitcoin',exact:true}).click();
  await page.getByRole('button',{name:'Bitcoin on-chain deposit',exact:true}).click();
  await expect(page.getByText('Send only bitcoin (BTC) on the Bitcoin network.',{exact:true})).toBeVisible();
  const readable=async(selector:string)=>page.locator(selector).evaluate(el=>{
    const luminance=(color:string)=>{
      const [r,g,b]=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
      return r*.2126+g*.7152+b*.0722;
    };
    let surface:Element|null=el;
    while(surface&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
    const a=luminance(getComputedStyle(el).color),b=luminance(getComputedStyle(surface??document.body).backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(await readable('[data-testid="bitcoin-address-text"] [data-testid="copy-button"]')).toBeGreaterThanOrEqual(4.5);
  expect(await readable('.gys-deposit-guidance + button')).toBeGreaterThanOrEqual(4.5);
});
