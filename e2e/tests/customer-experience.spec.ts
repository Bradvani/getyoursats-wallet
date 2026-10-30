import {test,expect} from '@playwright/test';
const fixture='/e2e/fixtures/premium-ui.html';
test.beforeEach(async({page})=>{
 await page.route('https://**/*',route=>route.abort());
 await page.route('**/api/notifications/device',route=>route.fulfill({json:{available:false}}));
});

test('settings keeps support tools and payment controls behind deliberate actions',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture+'?screen=settings');
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings).toBeVisible();
 await expect(settings.getByRole('button',{name:/test notification|test vibration|preview alert/i})).toHaveCount(0);
 await expect(settings.getByText(/Translations are being reviewed|provider webhook|Breez/i)).toHaveCount(0);
 await expect(settings.getByRole('button',{name:'Save payment settings'})).toHaveCount(0);
 await expect(settings.getByRole('button',{name:'Download support report'})).not.toBeVisible();
 await settings.locator('summary').filter({hasText:'Troubleshooting'}).click();
 await expect(settings.getByRole('button',{name:'Download support report'})).toBeVisible();
 await expect(settings.getByRole('link',{name:'Support',exact:true})).toHaveAttribute('href','https://getyoursats.com/support?lang=en');
 await settings.locator('summary').filter({hasText:'Payment settings'}).click();
 const fee=settings.getByLabel('Maximum fee (sats)');await fee.fill('275');
 const save=settings.getByRole('button',{name:'Save payment settings'});await expect(save).toBeEnabled();
 await fee.fill('');await expect(save).toBeDisabled();
 await fee.fill('275');await save.click();
 await expect(page.getByRole('button',{name:'Save payment settings'})).toHaveCount(0);
 await page.locator('summary').filter({hasText:'Payment settings'}).click();
 await expect(page.getByLabel('Maximum fee (sats)')).toHaveValue('275');
});

test('mobile keyboard focus stays in settings and nested dialogs close independently',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture+'?screen=settings');
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await expect(settings.getByRole('heading',{name:'Settings',exact:true})).toBeFocused();
 for(let i=0;i<24;i++){
  await page.keyboard.press('Tab');
  expect(await settings.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 }
 await settings.locator('summary').filter({hasText:'Payment settings'}).click();
 await page.getByTestId('review-balance-mode').click();
 const warning=page.getByTestId('stable-mode-warning');await expect(warning).toBeVisible();
 await page.keyboard.press('Tab');
 expect(await warning.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(warning).toHaveCount(0);
 await expect(settings).toBeVisible();
 await expect(page.getByTestId('review-balance-mode')).toBeFocused();
 await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);
 await expect(page.getByTestId('send-button')).toBeVisible();
});

test('desktop settings leaves the persistent wallet navigation reachable by keyboard',async({page})=>{
 await page.setViewportSize({width:1366,height:900});
 await page.goto(fixture+'?screen=settings');
 const nav=page.getByRole('complementary',{name:'Wallet navigation'});
 const history=nav.getByRole('button',{name:'History',exact:true});
 await history.focus();await expect(history).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'History',exact:true})).toBeVisible();
});

test('language options remain keyboard accessible inside settings',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(fixture+'?screen=settings');
 const language=page.getByRole('combobox',{name:'Language',exact:true});await language.fill('Español');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(page.locator('html')).toHaveAttribute('lang','es');
 await expect(page.getByRole('heading',{name:'Ajustes',exact:true})).toBeVisible();
});

for(const language of ['en','hi','ar'])test(`settings reflows at 320px and enlarged text in ${language}`,async({page})=>{
 await page.addInitScript(value=>localStorage.setItem('gys:language:v1',value),language);
 await page.setViewportSize({width:320,height:720});await page.goto(fixture+'?screen=settings');
 await page.addStyleTag({content:'html{font-size:32px!important}'});await page.evaluate(()=>document.fonts.ready);
 const choices=page.locator('.gys-settings-choice');await expect(choices).toHaveCount(3);
 const bounds=await choices.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,x:r.x,right:r.right}}));
 expect(bounds.every(r=>r.width>=170&&r.x>=0&&r.right<=320)).toBe(true);
 const layout=await page.locator('.gys-page-surface').evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
 expect(layout.content).toBeLessThanOrEqual(layout.width+1);
 await choices.last().scrollIntoViewIfNeeded();
 await page.screenshot({path:`test-artifacts/customer-settings-zoom-${language}.png`});
});

test('history follows Arabic and keeps filters and export usable',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('gys:language:v1','ar'));
 await page.setViewportSize({width:390,height:844});await page.goto(fixture);
 await page.getByRole('button',{name:/عرض سجل المعاملات الكامل/}).click();
 const search=page.getByRole('searchbox',{name:'البحث في المعاملات'});await expect(search).toBeVisible();
 await search.fill('no-matching-record');await expect(page.getByText('لا توجد معاملات تطابق هذه الفلاتر.')).toBeVisible();
 await page.getByRole('button',{name:'مسح الفلاتر'}).click();await expect(search).toHaveValue('');
 await expect(page.getByRole('button',{name:'تصدير CSV'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [390,1366])test(`history opens at its heading after scrolling the feed at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto(fixture);
 await page.getByRole('button',{name:'View full transaction history'}).click();
 await expect(page.getByRole('heading',{name:'History',exact:true})).toBeInViewport({ratio:1});
 await expect(page.getByRole('searchbox',{name:'Search transactions'})).toBeInViewport({ratio:1});
 await expect.poll(()=>page.locator('#gys-wallet-history').evaluate(el=>el.scrollTop)).toBe(0);
 await expect(page.getByTestId('transaction-item').first()).toBeInViewport({ratio:1});
 await page.getByRole('button',{name:'Back to Wallet'}).click();
 await expect(page.getByTestId('bitcoin-market')).toBeInViewport();
});
