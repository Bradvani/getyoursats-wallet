import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES, getAppLanguage, setAppLanguage } from '@/services/presentationPreferences';
const source=readFileSync('site/privacy-locales.js','utf8');
const copy=JSON.parse(source.split('window.GYS_PRIVACY = ')[1].replace(/;\s*$/,''));
describe('complete privacy locale catalogs',()=>{
 it('matches the wallet language list exactly',()=>expect(Object.keys(copy).sort()).toEqual(APP_LANGUAGES.map(x=>x.code).sort()));
 for(const {code} of APP_LANGUAGES)it(`${code} includes every disclosure and contact state`,()=>{
  const c=copy[code];expect(c.headings).toHaveLength(6);expect(c.paragraphs).toHaveLength(8);expect(c.ui).toHaveLength(11);
  expect(Object.keys(c.form).sort()).toEqual(Object.keys(copy.en.form).sort());
  expect(c.form.topics).toHaveLength(6);
  expect(c.paragraphs[2]).toContain('Upstash');expect(c.paragraphs[2]).toContain('Resend');
  expect(c.paragraphs[2]).toContain('5');expect(c.paragraphs[2]).toContain('10');
  expect(c.paragraphs[3]).toContain('username@getyoursats.com');
  expect(c.paragraphs[4]).toContain('Vercel');expect(c.paragraphs[4]).toContain('KYC');
  expect(c.paragraphs[6]).toContain('Bitcoin');expect(c.paragraphs[6]).toContain('Lightning');
  if(code!=='en')for(let i=0;i<8;i++)expect(c.paragraphs[i]).not.toBe(copy.en.paragraphs[i]);
 });
 it('keeps the wallet and website resources identical',()=>{
  for(const file of ['privacy-locales.js','privacy-page.js','help-center.js','help-style.css'])expect(readFileSync('public/'+file,'utf8')).toBe(readFileSync('site/'+file,'utf8'));
 });
 it('honors a language link and lets the user change it',()=>{
  const previous=window.location.href;
  window.history.replaceState(null,'','/?lang=ja#contact');expect(getAppLanguage()).toBe('ja');
  setAppLanguage('ar');expect(getAppLanguage()).toBe('ar');expect(window.location.hash).toBe('#contact');
  window.history.replaceState(null,'',previous);
 });
 it('keeps protected terms in their original script in existing catalogs',()=>{
  const files=['src/locales/asian.ts','src/locales/walletSetup.ts','src/services/presentationPreferences.ts','site/help-center.js','site/wallet-guide.js'];
  for(const f of files)expect(readFileSync(f,'utf8'),f).not.toMatch(/बिटकॉइन|ビットコイン|บิตคอยน์|பிட்காயின்|比特币|بيتكوين|लाइटनिंग|ライトニング|闪电网络|सैट|ساتوشي|每一聪|更多聪|发送聪|聪是稀缺/);
 });
});
