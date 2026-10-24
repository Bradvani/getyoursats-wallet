import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';

test('@public-smoke scarcity rulebook simulator teaches the two mechanisms without forecasting prices',async({page})=>{
 await page.route('**/help-center.js',async route=>route.fulfill({
  status:200,contentType:'application/javascript',body:readFileSync('site/help-center.js','utf8')
 }));
 await page.route('**/help-style.css',async route=>route.fulfill({
  status:200,contentType:'text/css',body:readFileSync('site/help-style.css','utf8')
 }));
 await page.setViewportSize({width:390,height:844});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/site/support.html?lang=en');
 const section=page.locator('.gys-rule-simulator');
 await expect(section).toBeVisible();
 await expect(section.getByText('Maximum issuance stays ≈21M BTC')).toBeVisible();
 await expect(section.getByText('Issued in this simplified example',{exact:false})).toContainText('19.688M BTC');
 await expect(section.getByText('This example now has',{exact:false})).toContainText('10');
 await expect(section.locator('.gys-fiat-unit')).toHaveCount(10);
 const ring=section.locator('.gys-rule-fill');
 const before=await ring.getAttribute('stroke-dasharray');
 await section.getByRole('button',{name:'Illustrative halving milestone 2012'}).click();
 await expect(section.getByText('Issued in this simplified example',{exact:false})).toContainText('10.5M BTC');
 expect(await ring.getAttribute('stroke-dasharray')).not.toEqual(before);
 await section.getByRole('button',{name:'Issue 10 more units'}).click();
 await expect(section.locator('.gys-fiat-unit')).toHaveCount(20);
 await expect(section.getByText('This example now has',{exact:false})).toContainText('20');
 await expect(section.getByText('The Bitcoin supply cap has not moved.')).toBeVisible();
 await section.getByRole('button',{name:'Start over'}).click();
 await expect(section.locator('.gys-fiat-unit')).toHaveCount(10);
 await expect(section.locator('input[type=range]')).toHaveCount(0);
 mkdirSync('test-artifacts',{recursive:true});
 await page.screenshot({path:'test-artifacts/bitcoin-rulebook-mobile.png',fullPage:true,animations:'disabled'});
 const languages=[['hi','दो नियम, एक बड़ा अंतर।'],['es','Dos reglas. Una gran diferencia.'],['pt','Duas regras. Uma grande diferença.']];
 for(const [code,title] of languages){
  await page.locator('#gys-language').selectOption(code);
  await expect(page.getByRole('heading',{name:title})).toBeVisible();
  await expect(section.locator('.gys-fiat-unit')).toHaveCount(10);
 }
 expect(errors).toEqual([]);
});
