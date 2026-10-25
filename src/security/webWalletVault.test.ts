import {afterEach,beforeEach,describe,expect,it} from 'vitest';
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
 it('repairs damaged vault metadata with matching words while retaining prior record',async()=>{
  await enrollWebWallet(WORDS,'old-wallet-password-12345');
  localStorage.setItem(WEB_VAULT_KEY,'{broken-json');
  await resetWebWalletPasswordWithWords(WORDS,'replacement-wallet-password-6789');
  expect(await unlockWebWallet('replacement-wallet-password-6789')).toBe(WORDS);
  const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)??'');
  const preserved=keys.filter(k=>k.startsWith('gys:wallet-vault:preserved-previous'));
  expect(preserved).toHaveLength(1);
  expect(localStorage.getItem(preserved[0])).toBe('{broken-json');
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
 it('rejects damaged or unknown data without erasing it',async()=>{
  localStorage.setItem(WEB_VAULT_KEY,'{"v":1,"bad":true}');
  await expect(unlockWebWallet('some-long-passphrase')).rejects.toThrow();
  expect(localStorage.getItem(WEB_VAULT_KEY)).toContain('bad');
 });
});
