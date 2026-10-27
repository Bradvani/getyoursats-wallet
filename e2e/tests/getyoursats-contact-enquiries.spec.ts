import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const base='http://localhost:5173/site/';
const choices=[
 ['support','Wallet & payment help'],
 ['feedback','Product feedback & ideas'],
 ['partnership','Partnerships & affiliations'],
 ['media','Media & community collaborations'],
 ['privacy','Privacy & data requests'],
 ['general','General enquiry'],
];

test.beforeEach(async({page})=>{
 await page.route('**/help-center.js',route=>route.fulfill({
  contentType:'application/javascript',body:readFileSync('site/help-center.js','utf8')
 }));
 await page.route('**/help-style.css',route=>route.fulfill({
  contentType:'text/css',body:readFileSync('site/help-style.css','utf8')
 }));
});

test('@public-smoke support form offers action-oriented enquiries without implying key recovery',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const submissions:Array<{topic?:string;email?:string;message?:string}>=[];
 await page.route('**/api/contact',async route=>{
  if(route.request().method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true})});
  submissions.push(route.request().postDataJSON());
  return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({ok:true,reference:'GYS-CATEGORY-QA'})});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'support.html?lang=en');
 const subject=page.locator('#gys-topic');
 await expect(subject).toBeEnabled();
 await expect(subject).toHaveValue('');
 await expect(subject.locator('option')).toHaveCount(7);
 for(const [id,label] of choices)await expect(subject.locator('option[value="'+id+'"]')).toHaveText(label);
 await expect(subject).not.toContainText('Wallet recovery');
 await expect(subject).not.toContainText('Bitcoin mining');
 await expect(page.locator('#gys-enquiry-note')).toBeHidden();
 await subject.selectOption('support');
 await expect(page.locator('#gys-enquiry-note')).toBeVisible();
 await expect(page.locator('#gys-enquiry-note')).toContainText('cannot restore lost seed phrases');
 await subject.selectOption('partnership');
 await expect(page.locator('#gys-enquiry-note')).toBeHidden();
 await page.locator('#gys-email').fill('quality-check@example.com');
 await page.locator('#gys-message').fill('I would like to discuss a potential partnership and community collaboration.');
 await page.locator('input[name=consent]').check();
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByRole('status',{name:''}).last()).toContainText('GYS-CATEGORY-QA');
 expect(submissions[submissions.length - 1]?.topic).toBe('partnership');
 expect(submissions[submissions.length - 1]?.message).toContain('potential partnership');
 expect(errors).toEqual([]);
});

test('@public-smoke privacy page retains relevant preselection and localized enquiry labels',async({page})=>{
 await page.route('**/api/contact',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true})}));
 await page.goto(base+'privacy.html?lang=en');
 const subject=page.locator('#gys-topic');
 await expect(subject).toHaveValue('privacy');
 const translations=[
  ['hi','साझेदारी और एफिलिएट्स'],
  ['es','Alianzas y afiliaciones'],
  ['pt','Parcerias e afiliações'],
  ['en','Partnerships & affiliations'],
 ];
 for(const [language,label] of translations){
  await page.locator('#gys-language').selectOption(language);
  await expect(subject.locator('option[value=partnership]')).toHaveText(label);
  await expect(subject).toHaveValue('privacy');
 }
 await expect(subject.locator('option[value=recovery]')).toHaveCount(0);
 await expect(subject.locator('option[value=mining]')).toHaveCount(0);
});
