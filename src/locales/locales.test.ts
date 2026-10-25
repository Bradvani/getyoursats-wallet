import { describe, it, expect } from 'vitest';
import {
  APP_LANGUAGES,
  detectAppLanguage,
  HOME_COPY,
  WALLET_COPY,
  appCopy,
  setAppLanguage,
  getAppLanguage,
  initPresentation,
} from '@/services/presentationPreferences';
import { TRUST_COPY } from '@/getyoursats/trustCopy';
import { PAYMENT_UX } from './paymentUx';

describe('supported language catalogs', () => {
  for (const { code } of APP_LANGUAGES)
    it(`${code} has complete catalogs and survives startup`, () => {
      for (const catalog of [HOME_COPY, WALLET_COPY, TRUST_COPY, PAYMENT_UX]) {
        expect(Object.keys(catalog[code]).sort()).toEqual(
          Object.keys(catalog.en).sort()
        );
        expect(
          Object.values(catalog[code]).every(
            (value) => typeof value === 'string' && value.trim().length > 0
          )
        ).toBe(true);
      }
      expect(Object.keys(appCopy(code)).sort()).toEqual(
        Object.keys(appCopy('en')).sort()
      );
      setAppLanguage(code);
      initPresentation();
      expect(getAppLanguage()).toBe(code);
      expect(document.documentElement.lang).toBe(code);
      expect(document.documentElement.dir).toBe(code === 'ar' ? 'rtl' : 'ltr');
    });
  it('clears RTL when switching back to English', () => {
    setAppLanguage('ar');
    setAppLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
  it('falls back safely for an unknown stored locale', () => {
    localStorage.setItem('gys:language:v1', 'unknown');
    initPresentation();
    expect(getAppLanguage()).toBe('en');
  });
});

describe('device language selection',()=>{
 it.each([['ja-JP','ja'],['th-TH','th'],['vi-VN','vi'],['ta-IN','ta'],['ar-AE','ar'],['zh-Hans-SG','zh-CN'],['zh-TW','en']])('maps %s to %s',(input,expected)=>expect(detectAppLanguage([input])).toBe(expected));
 it('respects the first supported device preference',()=>expect(detectAppLanguage(['fr-FR','ta-IN','en-US'])).toBe('ta'));
 it('retains an explicit choice',()=>{setAppLanguage('es');expect(getAppLanguage()).toBe('es')});
});
