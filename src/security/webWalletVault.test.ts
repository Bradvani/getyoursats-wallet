import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {rememberSignerIdentity,clearSignerIdentity,lockSpendingSession} from './spendApproval';
import {installVaultTestLock} from './vaultTestLock';
import {enrollWebWallet,unlockWebWallet,checkWebWalletPassword,
  getUnlockedWebMnemonic,hasWebWalletVault,removeMatchingLegacyMnemonic,clearUnlockedWebMnemonic,WEB_VAULT_KEY,resetWebWalletPasswordWithWords} from './webWalletVault';

const WORDS='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER='legal winner thank year wave sausage worth useful legal winner thank yellow';
beforeEach(()=>{localStorage.clear();clearUnlockedWebMnemonic();clearSignerIdentity();installVaultTestLock()});
afterEach(()=>{localStorage.clear();clearUnlockedWebMnemonic();clearSignerIdentity()});
// Use the production KDF cost, including on shared CI workers.
describe('browser phrase vault',{timeout:20_000},()=>{
 it('writes only AES-GCM ciphertext and can unlock with the same phrase',async()=>{
  await enrollWebWallet(WORDS,'very-long-wallet-password-123');
  const raw=localStorage.getItem(WEB_VAULT_KEY)!;
  expect(raw).not.toContain('abandon');
  expect(localStorage.getItem('walletMnemonic')).toBeNull();
  expect(JSON.parse(raw).cipher).toBe('AES-GCM');
  expect(await unlockWebWallet('very-long-wallet-password-123')).toBe(WORDS);
  await rememberSignerIdentity({type:'mnemonic',mnemonic:WORDS});
  expect(await checkWebWalletPassword('very-long-wallet-password-123')).toBe(true);
  expect(await checkWebWalletPassword('wrong password')).toBe(false);
 });
 it('preserves plaintext until same mnemonic is verified, never deletes a mismatch',async()=>{
  localStorage.setItem('walletMnemonic',OTHER);
  await enrollWebWallet(WORDS,'another-long-password-456');
  await expect(removeMatchingLegacyMnemonic('another-long-password-456')).rejects.toThrow(/does not match/);
  expect(localStorage.getItem('walletMnemonic')).toBe(OTHER);
 });
 it('migrates a matching legacy phrase only after verification',async()=>{
  localStorage.setItem('walletMnemonic',WORDS);
  await enrollWebWallet(WORDS,'another-long-password-456');
  await removeMatchingLegacyMnemonic('another-long-password-456');
  expect(localStorage.getItem('walletMnemonic')).toBeNull();
  expect(hasWebWalletVault()).toBe(true);
 });
 it('never overwrites an existing encrypted wallet with a different seed',async()=>{
  await enrollWebWallet(WORDS,'long-phrase-protection-789');
  await expect(enrollWebWallet(OTHER,'long-phrase-protection-789')).rejects.toThrow(/different/);
  expect(await unlockWebWallet('long-phrase-protection-789')).toBe(WORDS);
 });
 it('recovers same wallet with original words without changing wallet identity',async()=>{
  await enrollWebWallet(WORDS,'old-long-wallet-password');
  const original=localStorage.getItem(WEB_VAULT_KEY);
  await expect(resetWebWalletPasswordWithWords(OTHER,'different-password-long')).rejects.toThrow(/do not match/);
  expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(original);
  await resetWebWalletPasswordWithWords(WORDS,'new-long-wallet-password');
  expect(await unlockWebWallet('new-long-wallet-password')).toBe(WORDS);
  await expect(unlockWebWallet('old-long-wallet-password')).rejects.toThrow();
 });
 it('serializes competing enrolments so a second wallet never overwrites the first',async()=>{
  const both=await Promise.allSettled([
    enrollWebWallet(WORDS,'shared-test-password-12345'),
    enrollWebWallet(OTHER,'shared-test-password-12345'),
  ]);
  expect(both.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(both.filter(r=>r.status==='rejected')).toHaveLength(1);
  const decrypted=await unlockWebWallet('shared-test-password-12345');
  expect([WORDS,OTHER]).toContain(decrypted);
 });
 it.each(['{broken-json',''])('repairs damaged vault metadata %j with matching words while retaining prior record',async damaged=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');
  localStorage.setItem(WEB_VAULT_KEY,damaged);
  await resetWebWalletPasswordWithWords(WORDS,'replacement-wallet-password-6789');
  expect(await unlockWebWallet('replacement-wallet-password-6789')).toBe(WORDS);
  const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)??'');
  const preserved=keys.filter(k=>k.startsWith('gys:wallet-vault:preserved-previous'));
  expect(preserved).toHaveLength(1);
  expect(localStorage.getItem(preserved[0])).toBe(damaged);
 });
 it('cannot restore an active phrase after a lock interrupts decryption',async()=>{
  await enrollWebWallet(WORDS,'long-wallet-password-12345');
  clearUnlockedWebMnemonic();
  const unlocking=unlockWebWallet('long-wallet-password-12345');
  lockSpendingSession('Backgrounded during decryption');
  await expect(unlocking).rejects.toThrow(/session changed/);
  expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('rejects a vault replaced during decryption without activating its phrase',async()=>{
  await enrollWebWallet(WORDS,'long-wallet-password-12345');
  clearUnlockedWebMnemonic();
  const unlocking=unlockWebWallet('long-wallet-password-12345');
  localStorage.setItem(WEB_VAULT_KEY,'changed by another tab');
  await expect(unlocking).rejects.toThrow(/vault changed/);
  expect(getUnlockedWebMnemonic()).toBeNull();
  expect(localStorage.getItem(WEB_VAULT_KEY)).toBe('changed by another tab');
 });
 it('does not enroll or activate a phrase when backgrounding interrupts encryption',async()=>{
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
  const spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{
   const result=await encrypt(...args);lockSpendingSession('Background during encryption');return result;
  });
  try {
   await expect(enrollWebWallet(WORDS,'long-wallet-password-12345')).rejects.toThrow(/session changed/);
   expect(localStorage.getItem(WEB_VAULT_KEY)).toBeNull();expect(getUnlockedWebMnemonic()).toBeNull();
  } finally {spy.mockRestore();}
 });
 it('preserves the old ciphertext when lock interrupts password replacement',async()=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');clearUnlockedWebMnemonic();
  const previous=localStorage.getItem(WEB_VAULT_KEY);
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);
  const spy=vi.spyOn(crypto.subtle,'encrypt').mockImplementationOnce(async(...args)=>{
   const result=await encrypt(...args);lockSpendingSession('Background during reset');return result;
  });
  try {
   await expect(resetWebWalletPasswordWithWords(WORDS,'replacement-wallet-password-12345')).rejects.toThrow(/session changed/);
   expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(previous);expect(getUnlockedWebMnemonic()).toBeNull();
  } finally {spy.mockRestore();}
 });
 it('recovers when a malformed recovery hint has a surviving record fingerprint',async()=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');
  const original=localStorage.getItem(WEB_VAULT_KEY)!;
  const damaged=JSON.parse(original);damaged.iv='broken';
  localStorage.setItem(WEB_VAULT_KEY,JSON.stringify(damaged));
  localStorage.setItem('gys:wallet-vault:recovery-fingerprint:v1','invalid-base64!');
  clearUnlockedWebMnemonic();
  await resetWebWalletPasswordWithWords(WORDS,'new-wallet-password-67890');
  expect(await unlockWebWallet('new-wallet-password-67890')).toBe(WORDS);
  const manifestBackups=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)??'').filter(key=>key.startsWith('gys:wallet-recovery:preserved-manifest:'));
  expect(manifestBackups).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(manifestBackups[0])!)).toEqual({hint:'invalid-base64!'});
  expect(JSON.parse(localStorage.getItem(WEB_VAULT_KEY)!).v).toBe(1);
 });
 it('preserves both damaged records and gives a real separate-device recovery route',async()=>{
  localStorage.setItem(WEB_VAULT_KEY,'{damaged');
  localStorage.setItem('gys:wallet-vault:recovery-fingerprint:v1','damaged-hint');
  await expect(resetWebWalletPasswordWithWords(WORDS,'new-wallet-password-12345')).rejects.toThrow(/another device or a separate browser profile/);
  expect(localStorage.getItem(WEB_VAULT_KEY)).toBe('{damaged');
  expect(localStorage.getItem('gys:wallet-vault:recovery-fingerprint:v1')).toBe('damaged-hint');
  expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('refuses two different valid recovery identity records',async()=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');
  const raw=localStorage.getItem(WEB_VAULT_KEY);
  localStorage.setItem('gys:wallet-vault:recovery-fingerprint:v1',btoa('a'.repeat(32)));
  await expect(resetWebWalletPasswordWithWords(WORDS,'new-wallet-password-12345')).rejects.toThrow(/Conflicting/);
  expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(raw);
 });
 it.each(['backup','hint','vault'])('preserves the live wallet when %s storage fails during password recovery',async phase=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');clearUnlockedWebMnemonic();
  const raw=localStorage.getItem(WEB_VAULT_KEY);
  const hintKey='gys:wallet-vault:recovery-fingerprint:v1';
  // Repair would change this hint, so a failed vault write must restore it.
  localStorage.setItem(hintKey,'malformed-original-hint');
  const write=vi.mocked(localStorage.setItem).getMockImplementation()!;
  let failed=false;
  const spy=vi.mocked(localStorage.setItem).mockImplementation((key,value)=>{
   const matches=phase==='backup'?key.startsWith('gys:wallet-vault:preserved-previous:'):phase==='hint'?key===hintKey:key===WEB_VAULT_KEY;
   if(matches&&!failed){failed=true;throw new DOMException('Storage quota exceeded','QuotaExceededError');}
   write(key,value);
  });
  try {
   await expect(resetWebWalletPasswordWithWords(WORDS,'new-wallet-password-12345')).rejects.toThrow(/quota/);
   expect(failed).toBe(true);expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(raw);
   expect(localStorage.getItem(hintKey)).toBe('malformed-original-hint');expect(getUnlockedWebMnemonic()).toBeNull();
   const storageEntries=localStorage.length;failed=false;
   await expect(resetWebWalletPasswordWithWords(WORDS,'new-wallet-password-12345')).rejects.toThrow(/quota/);
   expect(localStorage.length).toBe(storageEntries);expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(raw);
  } finally {spy.mockImplementation(write);}
  expect(await unlockWebWallet('old-wallet-password-12345')).toBe(WORDS);
 });
 it('retains legacy words and rolls back the hint if initial encrypted save runs out of space',async()=>{
  localStorage.setItem('walletMnemonic',WORDS);
  const write=vi.mocked(localStorage.setItem).getMockImplementation()!;
  const spy=vi.mocked(localStorage.setItem).mockImplementation((key,value)=>{
   if(key===WEB_VAULT_KEY)throw new DOMException('Storage quota exceeded','QuotaExceededError');
   write(key,value);
  });
  try {
   await expect(enrollWebWallet(WORDS,'new-wallet-password-12345')).rejects.toThrow(/quota/);
   expect(localStorage.getItem('walletMnemonic')).toBe(WORDS);expect(localStorage.getItem(WEB_VAULT_KEY)).toBeNull();
   expect(localStorage.getItem('gys:wallet-vault:recovery-fingerprint:v1')).toBeNull();expect(getUnlockedWebMnemonic()).toBeNull();
  } finally {spy.mockImplementation(write);}
 });
 it('rejects damaged or unknown data without erasing it',async()=>{
  localStorage.setItem(WEB_VAULT_KEY,'{"v":1,"bad":true}');
  await expect(unlockWebWallet('some-long-passphrase')).rejects.toThrow();
  expect(localStorage.getItem(WEB_VAULT_KEY)).toContain('bad');
 });
});
