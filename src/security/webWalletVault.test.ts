import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {enrollWebWallet,unlockWebWallet,checkWebWalletPassword,
  hasWebWalletVault,removeMatchingLegacyMnemonic,clearUnlockedWebMnemonic,WEB_VAULT_KEY,resetWebWalletPasswordWithWords} from './webWalletVault';

const WORDS='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER='legal winner thank year wave sausage worth useful legal winner thank yellow';
beforeEach(()=>{localStorage.clear();clearUnlockedWebMnemonic()});
afterEach(()=>{localStorage.clear();clearUnlockedWebMnemonic()});
describe('browser phrase vault',()=>{
 it('writes only AES-GCM ciphertext and can unlock with the same phrase',async()=>{
  await enrollWebWallet(WORDS,'very-long-wallet-password-123');
  const raw=localStorage.getItem(WEB_VAULT_KEY)!;
  expect(raw).not.toContain('abandon');
  expect(localStorage.getItem('walletMnemonic')).toBeNull();
  expect(JSON.parse(raw).cipher).toBe('AES-GCM');
  expect(await unlockWebWallet('very-long-wallet-password-123')).toBe(WORDS);
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
 it('rejects damaged or unknown data without erasing it',async()=>{
  localStorage.setItem(WEB_VAULT_KEY,'{"v":1,"bad":true}');
  await expect(unlockWebWallet('some-long-passphrase')).rejects.toThrow();
  expect(localStorage.getItem(WEB_VAULT_KEY)).toContain('bad');
 });
});
