import {describe,it,expect} from 'vitest';
import {passkeyUnlockErrorMessage,PASSKEY_INCOMPLETE_MESSAGE,PASSKEY_FAILED_MESSAGE} from './passkeyUnlockFeedback';
import {APP_LANGUAGES} from '../services/presentationPreferences';
import {flowText} from '../locales/flowText';

describe('passkey unlock feedback',()=>{
 it.each(['NotAllowedError','AbortError'])('does not claim that %s definitively means cancellation',name=>{
  expect(passkeyUnlockErrorMessage(new DOMException('prompt ended',name))).toBe(PASSKEY_INCOMPLETE_MESSAGE);
 });
 it.each(['USER_CANCELLED','USER_CANCELED','ABORT_ERR'])('treats %s as incomplete without changing wallet state',code=>{
  expect(passkeyUnlockErrorMessage(Object.assign(new Error('prompt ended'),{code}))).toBe(PASSKEY_INCOMPLETE_MESSAGE);
 });
 it('recognizes wrapped browser errors',()=>{
  expect(passkeyUnlockErrorMessage(new Error('PRF error: NotAllowedError'))).toBe(PASSKEY_INCOMPLETE_MESSAGE);
 });
 it('retains useful network failure guidance',()=>{
  expect(passkeyUnlockErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Network problem/);
 });
 it('does not turn unknown or malformed errors into an asserted user cancellation',()=>{
  for(const value of [null,undefined,{},new Error('unknown'),'unknown']) expect(passkeyUnlockErrorMessage(value)).toBe(PASSKEY_FAILED_MESSAGE);
 });
 it('provides translated incomplete/failure guidance in all selected languages',()=>{
  for(const {code} of APP_LANGUAGES)for(const key of [PASSKEY_INCOMPLETE_MESSAGE,PASSKEY_FAILED_MESSAGE,'Wallet locked']){
   expect(flowText(code,key).length).toBeGreaterThan(0);
   if(code!=='en')expect(flowText(code,key)).not.toBe(key);
  }
 });
});
