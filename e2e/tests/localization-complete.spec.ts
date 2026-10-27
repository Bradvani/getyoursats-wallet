import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {flowText} from '../../src/locales/flowText';
import {PAYMENT_UX} from '../../src/locales/paymentUx';
import type {AppLanguage} from '../../src/services/presentationPreferences';
import completion from '../../src/locales/flowCompletion.json' with {type:'json'};
const support=JSON.parse(readFileSync('public/support-locales.js','utf8').split('window.GYS_SUPPORT = ')[1].replace(/;\s*$/,''));
const privacy=JSON.parse(readFileSync('public/privacy-locales.js','utf8').split('window.GYS_PRIVACY = ')[1].replace(/;\s*$/,''));
const languages=Object.keys(completion) as AppLanguage[];
for(const language of languages){
 test('complete send and balance language '+language,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const t=(key:string)=>flowText(language,key);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/e2e/fixtures/localization-complete.html?lang='+language);
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  const surface=page.getByTestId('localized-surface');
  await expect(surface).toContainText(t('Where would you like to send?'));
  const destination='spark1disposable_TEST_01';
  await surface.locator('textarea').fill(destination);
  await surface.getByRole('button',{name:t('Continue'),exact:true}).click();
  await expect(surface).toContainText(t('Amount'));
  await expect(surface).toContainText(destination);
  await surface.getByTestId('amount-input').fill('9999999');
  await expect(surface).toContainText(PAYMENT_UX[language].exceeds);
  await expect(surface.getByRole('button',{name:t('Continue'),exact:true})).toBeDisabled();
  await surface.getByTestId('amount-input').fill('1000');
  await surface.getByRole('button',{name:t('Continue'),exact:true}).click();
  await expect(surface.getByTestId('send-destination')).toHaveAttribute('title',destination);
  await expect(surface).toContainText(t('To Spark address'));
  await expect(surface).toContainText(t('Network fee'));
  if(['ar','ja','ta'].includes(language))await page.screenshot({path:`test-artifacts/send-${language}-390.png`});
  await expect(page.getByTestId('submitted')).toHaveText(JSON.stringify({destination,amount:'1000'}));
  await surface.getByTestId('send-confirm-button').click();
  await expect(surface).toContainText(t('Sending…'));
  await expect(surface.getByTestId('payment-success')).toBeVisible();
  await expect(surface).toContainText(t('Payment Sent!'));
  await expect(surface).toContainText(t('Done'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  for(const [screen,label] of [['balance','Balance'],['fees','Select Fee Rate'],['routes','Select coin'],['failure','Failed to prepare payment'],['unknown','Payment not confirmed']]){
   await page.goto('/e2e/fixtures/localization-complete.html?lang='+language+'&case='+screen);
   await expect(surface).toContainText(t(label));
  }
  await page.goto('/e2e/fixtures/localization-complete.html?lang='+language+'&case=contacts');
  await surface.getByRole('button',{name:t('Add contact'),exact:true}).click();
  await expect(surface).toContainText(t('New Contact'));
  await surface.getByRole('button',{name:t('Save'),exact:true}).click();
  await expect(surface).toContainText(t('Name is required'));
  await surface.locator('#subview-contact-name').fill('Untranslated user name');
  await page.getByLabel('Fixture language').selectOption(language==='ar'?'ja':'ar');
  await expect(surface.locator('#subview-contact-name')).toHaveValue('Untranslated user name');
  for(const [screen,label]of [['receive','Create Lightning Address'],['settings','Privacy & recovery'],['details','Date & Time']]){
   await page.goto('/e2e/fixtures/localization-complete.html?lang='+language+'&case='+screen);
   await expect(page.locator('body')).toContainText(t(label));
  }
  await page.goto('/e2e/fixtures/localization-complete.html?lang='+language+'&case=receiveamount');
  await expect(page.locator('body')).toContainText(t('Request amount'));
  await page.getByTestId('invoice-amount-input').fill('1000');
  await expect(page.getByTestId('generate-invoice-button')).toBeEnabled();
  await page.goto('/e2e/fixtures/localization-complete.html?lang='+language+'&case=provider-error');
  if(language!=='en'){
   await expect(surface).toContainText(t('Unable to complete this request. Check the details before trying again.'));
   await surface.locator('summary').click();
  }
  await expect(surface.getByText('Network unavailable: disposable provider diagnostic',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 });
 for(const host of ['site','wallet'])test('complete '+host+' Support '+language,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const submissions:Array<{email:string;message:string;topic:string}>=[];
  await page.route('**/api/contact',route=>{
   if(route.request().method()==='POST'){
    submissions.push(route.request().postDataJSON());
    return route.fulfill({status:202,contentType:'application/json',body:'{"ok":true,"reference":"GYS-LOCALE-TEST"}'});
   }
   return route.fulfill({status:200,contentType:'application/json',body:'{"available":true}'});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto((host==='site'?'/site/support.html':'/support.html')+'?lang='+language);
  await expect(page.locator('html')).toHaveAttribute('lang',language);
  await expect(page.locator('html')).toHaveAttribute('dir',language==='ar'?'rtl':'ltr');
  const c=support[language];
  await expect(page.locator('.hero h1')).toHaveText(privacy[language].ui[1]);
  for(const key of ['notice','payment1','payment2','merchant1','merchant2','address1','address2','keys1','keys2','keys3','investigate','learn'])await expect(page.locator('article')).toContainText(c[key]);
  await expect(page.locator('#gys-language option')).toHaveCount(10);
  if(host==='site'&&['ar','ja','ta'].includes(language))await page.screenshot({path:`test-artifacts/support-${language}-390.png`});
  expect(await page.locator('article').evaluate(node=>{
   const recovery=node.querySelector('#section-1'),keys=node.querySelector('#keys-and-recovery');
   return !!recovery&&!!keys&&!!(keys.compareDocumentPosition(recovery)&Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(page.locator('.navbar .wallet')).toHaveAttribute('href',new RegExp('lang='+language));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.toc a[href="#section-1"]').click();
  await expect(page.locator('#section-1')).toBeInViewport();
  if(host==='site'){
   await page.locator('#gys-email').fill('disposable@example.invalid');
   await page.locator('#gys-message').fill('Keep this draft');
   const nextLanguage=language==='ar'?'ja':'ar';
   await page.locator('#gys-language').selectOption(nextLanguage);
   await expect(page.locator('#gys-message')).toHaveValue('Keep this draft');
   await expect(page.locator('#gys-email')).toHaveValue('disposable@example.invalid');
   await page.locator('#gys-topic').selectOption('general');
   await page.locator('input[name=consent]').check();
   await page.getByRole('button',{name:privacy[nextLanguage].form.formSend,exact:true}).click();
   await expect(page.locator('#gys-contact-status')).toContainText(privacy[nextLanguage].form.formOk+'GYS-LOCALE-TEST');
   expect(submissions).toHaveLength(1);
   expect(submissions[0]).toMatchObject({email:'disposable@example.invalid',message:'Keep this draft',topic:'general'});
  }
  expect(errors).toEqual([]);
 });
}
test('all language catalogs cover identical keys and placeholders',()=>{
 const placeholders=(text:string)=>[...text.matchAll(/\{([A-Za-z]+)\}/g)].map(m=>m[1]).sort();
 for(const language of languages){
  expect(Object.keys(completion[language]).sort()).toEqual(Object.keys(completion.en).sort());
  for(const key of Object.keys(completion.en) as (keyof typeof completion.en)[]){
   expect(completion[language][key].trim()).not.toBe('');
   expect(placeholders(completion[language][key])).toEqual(placeholders(key));
  }
 }
});
test('wallet language survives public-link import and subsequent changes',async({page})=>{
 await page.goto('/e2e/fixtures/localization-complete.html?lang=ta');
 await expect(page.locator('html')).toHaveAttribute('lang','ta');
 await page.getByLabel('Fixture language').selectOption('ar');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await expect(page.locator('html')).toHaveAttribute('dir','rtl');
});
for(const language of ['ar','ta','ja'])test('readable narrow and enlarged Support '+language,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:320,height:740});
 await page.goto('/site/support.html?lang='+language);
 await expect(page.locator('#gys-language')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(()=>{document.documentElement.style.zoom='2';});
 await page.locator('.toc a[href="#keys-and-recovery"]').click();
 await expect(page.locator('#keys-and-recovery')).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`test-artifacts/support-${language}-200percent.png`});
});
