import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync('site/privacy-locales.js','utf8').split('window.GYS_PRIVACY = ')[1].replace(/;\s*$/,''));
test.beforeEach(async({page})=>{
 await page.route('https://wallet.getyoursats.com/brand/wordmark-horizontal-dark.svg',route=>route.fulfill({contentType:'image/svg+xml',headers:{'Cross-Origin-Resource-Policy':'cross-origin'},body:readFileSync('public/brand/wordmark-horizontal-dark.svg','utf8')}));
 for(const file of ['help-center.js','help-style.css','privacy-page.js','privacy-locales.js'])await page.route('**/'+file,route=>route.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body:readFileSync('site/'+file,'utf8')}));
 await page.route('**/api/contact',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true})}));
});
for(const locale of Object.keys(catalog))test(`@public-smoke complete privacy journey ${locale}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/site/privacy.html?lang='+locale);
 await expect(page.locator('html')).toHaveAttribute('lang',locale);
 await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
 await expect(page.locator('#gys-language option')).toHaveCount(10);
 const copy=catalog[locale];
 await expect(page.locator('.hero h1')).toHaveText(copy.title);
 await expect(page.locator('article h2')).toHaveText(copy.headings);
 for(const paragraph of copy.paragraphs)await expect(page.locator('article')).toContainText(paragraph);
 await expect(page.locator('[data-form-label=consent]')).toHaveText(copy.form.formConsent);
 await expect(page.locator('#gys-topic')).toHaveValue('privacy');
 await expect(page.locator('[data-form-label=submit]')).toHaveText(copy.form.formSend);
 await expect(page.locator('.navbar .wallet')).toHaveAttribute('href',new RegExp('lang='+locale));
 await expect(page.locator('article bdi').filter({hasText:'username@getyoursats.com'})).toHaveAttribute('dir','ltr');
 if(['hi','ja','th','vi','ta','ar','zh-CN'].includes(locale)){
  const family=({ar:'Noto Sans Arabic',ja:'Noto Sans JP',ta:'Noto Sans Tamil',hi:'Noto Sans Devanagari',th:'Noto Sans Thai',vi:'Plus Jakarta Sans','zh-CN':'Noto Sans SC'} as Record<string,string>)[locale];
  await expect(page.locator('body')).toHaveCSS('font-family',new RegExp(family));
  expect(await page.evaluate(async ({family,sample})=>{await document.fonts.load('16px \"'+family+'\"',sample);return document.fonts.check('16px \"'+family+'\"',sample);},{family,sample:copy.title})).toBe(true);
 }
 if(['ar','ja','ta'].includes(locale))await page.screenshot({path:`test-artifacts/privacy-${locale}-390.png`});
 await page.locator('.toc a').last().click();
 await expect(page.locator('#section-6')).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});
test('@public-smoke privacy language changes preserve form input and reset RTL',async({page})=>{
 await page.goto('/site/privacy.html?lang=ar');
 await page.locator('#gys-email').fill('disposable@example.invalid');
 await page.locator('#gys-message').fill('Disposable test text only.');
 await page.locator('#gys-language').selectOption('ja');
 await expect(page.locator('html')).toHaveAttribute('dir','ltr');
 await expect(page.locator('#gys-email')).toHaveValue('disposable@example.invalid');
 await expect(page.locator('#gys-message')).toHaveValue('Disposable test text only.');
 await page.reload();await expect(page.locator('#gys-language')).toHaveValue('ja');
});
test('@public-smoke wallet-hosted privacy forwards to the working contact form',async({page})=>{
 await page.goto('/privacy.html?lang=ta');
 await expect(page.locator('#privacy-contact-link')).toHaveAttribute('href','https://getyoursats.com/support?lang=ta#contact');
 await expect(page.locator('article h2')).toHaveCount(6);
 await expect(page.locator('#gys-contact')).toHaveCount(0);
});
test('@public-smoke localized contact failures do not leak an English server error',async({page})=>{
 await page.route('**/api/contact',route=>route.fulfill({status:route.request().method()==='GET'?200:400,contentType:'application/json',body:JSON.stringify(route.request().method()==='GET'?{available:true}:{error:'Internal English validation message'})}));
 await page.goto('/site/privacy.html?lang=ar');
 await page.locator('#gys-email').fill('disposable@example.invalid');
 await page.locator('#gys-message').fill('Disposable test text only.');
 await page.locator('input[name=consent]').check();await page.locator('[type=submit]').click();
 await expect(page.locator('#gys-contact-status')).toHaveText(catalog.ar.form.formErr);
});

for(const destination of ['privacy','support','learn','delete-account'])test(`@public-smoke ${destination} social footer fits a narrow phone`,async({page})=>{
 await page.setViewportSize({width:320,height:700});
 await page.goto('/site/'+destination+'.html?lang=en');
 const footer=page.locator('.footer-links');
 await footer.scrollIntoViewIfNeeded();
 await expect(footer.getByRole('link',{name:'X (Twitter)',exact:true})).toHaveAttribute('href','https://x.com/getyoursats');
 await expect(footer.getByRole('link',{name:'ChainReaction · Instagram',exact:true})).toHaveAttribute('href','https://www.instagram.com/getyoursats/');
 const box=await footer.boundingBox();
 expect(box).not.toBeNull();
 expect(box!.x).toBeGreaterThanOrEqual(0);
 expect(box!.x+box!.width).toBeLessThanOrEqual(320);
 expect(await footer.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
